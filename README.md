# Furthermore: Agentic Powered Expansion and Benchmarking

Furthermore is a functional prototype of an agentic AI workflow for code analysis, expansion, and benchmarking. It features a Python/FastAPI backend and a modern glassmorphism frontend.

## Architecture & Implementation Notes

1. **Frontend:** A responsive UI built with Vanilla HTML/CSS/JS. It provides a code editor area and a dashboard to display AI analysis, optimization proposals, and real-time execution benchmarks.
2. **Backend:** A FastAPI server handles requests from the frontend. It orchestrates the AI calls using the `google-genai` SDK and executes Python code locally using `subprocess` with a strict timeout to benchmark performance.
3. **AI Logic:** The system uses Gemini (e.g., `gemini-2.5-flash`) via structured outputs to read the user's code, determine its complexity, and generate exactly two expanded/optimized versions.

### Security Warning
**Local Code Execution Security**: This prototype executes code locally on your machine using Python's `subprocess` module to benchmark performance. While it has a strict timeout, it is inherently dangerous to execute AI-generated code without a strict sandbox (like Docker). **Only use this prototype with safe, non-destructive algorithms.**

## How to Run the Prototype

Since this prototype requires your personal Gemini API key and executes code locally, you must launch it manually from your terminal.

1. **Navigate to the project directory:**
   ```bash
   cd /home/huskten/.gemini/antigravity/scratch/code-agent-app
   ```

2. **Set your API Key:**
   Export your Gemini API key in the environment before starting the server.
   ```bash
   export GEMINI_API_KEY="your-api-key-here"
   ```

3. **Install Dependencies:**
   Ensure you have installed the required dependencies (if you haven't already):
   ```bash
   pip install -r requirements.txt
   ```

4. **Start the server:**
   Run the FastAPI server using `uvicorn`. Ensure you run it as a module using the `python3` executable where you installed the dependencies:
   ```bash
   python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```

5. **Open the App:**
   Open your browser and navigate to [http://localhost:8000](http://localhost:8000).

## Usage

When you open the web app, you will see a text area pre-populated with a naive recursive Fibonacci sequence.
Click **Analyze & Benchmark**.
The AI will:
1. Benchmark the original code.
2. Generate an analysis (e.g., identifying O(2^n) time complexity).
3. Propose faster architectural solutions (e.g., Memoization, Iteration).
4. Automatically benchmark those new solutions so you can directly compare the performance multiplier!
