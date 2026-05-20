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

@app.post("/api/analyze")
async def analyze_code(request: AnalyzeRequest):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY environment variable is not set on the server.")
    
    # 1. Run Original Code Benchmark
    original_benchmark = run_code_securely(request.code, request.language)
    
    # 2. Agent Workflow: Analyze and Propose
    try:
        client = genai.Client(api_key=api_key)
        
        prompt = f"""
        Analyze the following {request.language} code.
        Identify its current purpose and time/space complexity.
        Then, propose exactly 2 distinct ways to expand its scope, optimize it, or make it more robust.
        For each proposal, provide the FULL, runnable {request.language} code that implements the change. Ensure the code actually prints some output so it can be benchmarked.
        
        Code to analyze:
        ```{request.language}
        {request.code}
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
        benchmark_result = run_code_securely(proposal["code"], request.language)
        benchmarked_proposals.append({
            "name": proposal["name"],
            "description": proposal["description"],
            "code": proposal["code"],
            "benchmark": benchmark_result
        })

    return {
        "original_benchmark": original_benchmark,
        "summary": analysis_data.get("summary", ""),
        "complexity": analysis_data.get("complexity", ""),
        "proposals": benchmarked_proposals
    }
