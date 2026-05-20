import os
import json
import subprocess
import tempfile
import time
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from google import genai
from google.genai import types

app = FastAPI()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

class AnalyzeRequest(BaseModel):
    code: str
    language: str = "python"

class ExpansionProposal(BaseModel):
    name: str
    description: str
    code: str

class AnalysisResult(BaseModel):
    summary: str
    complexity: str
    proposals: list[ExpansionProposal]

class FixedCodeResponse(BaseModel):
    code: str

def run_code_securely(code: str, language: str = "python", timeout: int = 5) -> dict:
    """Runs code in a subprocess with a timeout and captures output."""
    start_time = time.time()
    try:
        if language == "python":
            with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
                f.write(code)
                temp_path = f.name
            
            result = subprocess.run(
                ['python3', temp_path],
                capture_output=True,
                text=True,
                timeout=timeout
            )
            os.remove(temp_path)
            
        elif language == "c":
            with tempfile.NamedTemporaryFile(mode='w', suffix='.c', delete=False) as f:
                f.write(code)
                temp_path = f.name
            
            out_path = temp_path[:-2] + ".out"
            compile_res = subprocess.run(['gcc', temp_path, '-o', out_path], capture_output=True, text=True)
            
            if compile_res.returncode != 0:
                os.remove(temp_path)
                return {
                    "success": False,
                    "stdout": "",
                    "stderr": f"Compilation Error:\n{compile_res.stderr}",
                    "execution_time_ms": 0
                }
                
            result = subprocess.run([out_path], capture_output=True, text=True, timeout=timeout)
            os.remove(temp_path)
            if os.path.exists(out_path):
                os.remove(out_path)
                
        elif language == "cpp":
            with tempfile.NamedTemporaryFile(mode='w', suffix='.cpp', delete=False) as f:
                f.write(code)
                temp_path = f.name
            
            out_path = temp_path[:-4] + ".out"
            compile_res = subprocess.run(['g++', temp_path, '-o', out_path], capture_output=True, text=True)
            
            if compile_res.returncode != 0:
                os.remove(temp_path)
                return {
                    "success": False,
                    "stdout": "",
                    "stderr": f"Compilation Error:\n{compile_res.stderr}",
                    "execution_time_ms": 0
                }
                
            result = subprocess.run([out_path], capture_output=True, text=True, timeout=timeout)
            os.remove(temp_path)
            if os.path.exists(out_path):
                os.remove(out_path)
        else:
            return {"success": False, "stdout": "", "stderr": "Unsupported language", "execution_time_ms": 0}

        end_time = time.time()
        
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "execution_time_ms": round((end_time - start_time) * 1000, 2)
        }
    except subprocess.TimeoutExpired:
        if 'temp_path' in locals() and os.path.exists(temp_path):
            os.remove(temp_path)
        if 'out_path' in locals() and os.path.exists(out_path):
            os.remove(out_path)
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Execution timed out after {timeout} seconds",
            "execution_time_ms": timeout * 1000
        }
    except Exception as e:
        return {
            "success": False,
            "stdout": "",
            "stderr": str(e),
            "execution_time_ms": 0
        }

def execute_and_fix_code(code: str, language: str, client: genai.Client, max_retries: int = 2) -> tuple[dict, str]:
    """Runs code securely. If it fails or outputs nothing, asks the LLM to fix it."""
    current_code = code
    final_result = None
    
    for attempt in range(max_retries):
        result = run_code_securely(current_code, language)
        final_result = result
        
        # Consider a run successful ONLY if it exits 0 AND produces some stdout (meaning we can benchmark it)
        if result["success"] and result["stdout"].strip() != "":
            return result, current_code
            
        if attempt == max_retries - 1:
            break
            
        # If it failed or produced no output, prompt the LLM to fix it
        error_context = result["stderr"] if not result["success"] else "The code ran successfully but produced no output. A benchmark requires some printed output."
        
        prompt = f"""
        The following {language} code failed to execute properly or produced no output.
        Please fix it so it compiles, runs cleanly, and prints an output.
        If it is just a function definition, add a test case and a print statement to execute it.
        If it is missing headers or imports, add them.
        
        Code:
        ```{language}
        {current_code}
        ```
        
        Execution Error / Context:
        {error_context}
        
        Output ONLY the full, fixed, runnable code. Do not wrap it in markdown or add explanations, just the code.
        """
        
        try:
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=FixedCodeResponse,
                    temperature=0.2,
                ),
            )
            fix_data = json.loads(response.text)
            current_code = fix_data["code"]
        except Exception:
            # If the LLM call fails, we just break and return the current failure
            break
            
    return final_result, current_code

@app.post("/api/analyze")
async def analyze_code(request: AnalyzeRequest):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY environment variable is not set on the server.")
    
    try:
        client = genai.Client(api_key=api_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Client Init Error: {str(e)}")

    # 1. Run Original Code Benchmark (and auto-fix if necessary)
    original_benchmark, fixed_original_code = execute_and_fix_code(request.code, request.language, client)
    
    # 2. Agent Workflow: Analyze and Propose
    try:
        prompt = f"""
        Analyze the following {request.language} code.
        Identify its current purpose and time/space complexity.
        Then, propose exactly 2 distinct ways to expand its scope, optimize it, or make it more robust.
        For each proposal, provide the FULL, runnable {request.language} code that implements the change. Ensure the code actually prints some output so it can be benchmarked.
        
        Code to analyze:
        ```{request.language}
        {fixed_original_code}
        ```
        """
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=AnalysisResult,
                temperature=0.4,
            ),
        )
        
        analysis_data = json.loads(response.text)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")

    # 3. Agent Workflow: Benchmark Proposals
    benchmarked_proposals = []
    for proposal in analysis_data.get("proposals", []):
        benchmark_result, final_proposal_code = execute_and_fix_code(proposal["code"], request.language, client)
        benchmarked_proposals.append({
            "name": proposal["name"],
            "description": proposal["description"],
            "code": final_proposal_code,
            "benchmark": benchmark_result
        })

    return {
        "original_benchmark": original_benchmark,
        "fixed_original_code": fixed_original_code if fixed_original_code.strip() != request.code.strip() else None,
        "summary": analysis_data.get("summary", ""),
        "complexity": analysis_data.get("complexity", ""),
        "proposals": benchmarked_proposals
    }
