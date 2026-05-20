document.addEventListener('DOMContentLoaded', () => {
    const analyzeBtn = document.getElementById('analyzeBtn');
    const codeInput = document.getElementById('codeInput');
    const languageSelect = document.getElementById('languageSelect');
    
    const loadingState = document.getElementById('loadingState');
    const analysisPanel = document.getElementById('analysisPanel');
    const proposalsContainer = document.getElementById('proposalsContainer');
    
    const originalResult = document.getElementById('originalResult');
    const origTime = document.getElementById('origTime');
    const origStatus = document.getElementById('origStatus');
    const origOutput = document.getElementById('origOutput');

    const placeholders = {
        python: `# Write some Python code here...\ndef calculate_fibonacci(n):\n    if n <= 1:\n        return n\n    return calculate_fibonacci(n-1) + calculate_fibonacci(n-2)\n\nprint('Result:', calculate_fibonacci(32))`,
        c: `// Write some C code here...\n#include <stdio.h>\n\nint calculate_fibonacci(int n) {\n    if (n <= 1) return n;\n    return calculate_fibonacci(n-1) + calculate_fibonacci(n-2);\n}\n\nint main() {\n    printf("Result: %d\\n", calculate_fibonacci(32));\n    return 0;\n}`,
        cpp: `// Write some C++ code here...\n#include <iostream>\n\nint calculate_fibonacci(int n) {\n    if (n <= 1) return n;\n    return calculate_fibonacci(n-1) + calculate_fibonacci(n-2);\n}\n\nint main() {\n    std::cout << "Result: " << calculate_fibonacci(32) << std::endl;\n    return 0;\n}`
    };

    languageSelect.addEventListener('change', (e) => {
        codeInput.placeholder = placeholders[e.target.value];
        codeInput.value = ""; // Clear existing code when changing language
    });

    analyzeBtn.addEventListener('click', async () => {
        const code = codeInput.value.trim() || codeInput.placeholder; // use placeholder if empty
        const language = languageSelect.value;
        if (!code) return;

        // Reset UI
        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0;"></div> Processing...';
        
        loadingState.classList.remove('hidden');
        analysisPanel.classList.add('hidden');
        proposalsContainer.innerHTML = '';
        originalResult.classList.add('hidden');

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ code, language })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || 'Failed to analyze code');
            }

            const data = await response.json();
            renderResults(data);

        } catch (error) {
            alert(`Error: ${error.message}\nMake sure your GEMINI_API_KEY is set in the backend environment.`);
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Analyze & Benchmark`;
            loadingState.classList.add('hidden');
        }
    });

    function renderResults(data) {
        // Render Original Benchmark
        const origB = data.original_benchmark;
        origTime.textContent = data.original_benchmark.execution_time_ms;
        
        const origFixedCodeBlock = document.getElementById('origFixedCodeBlock');
        const origFixedCode = document.getElementById('origFixedCode');
        
        if (data.fixed_original_code) {
            origFixedCode.textContent = data.fixed_original_code;
            origFixedCodeBlock.classList.remove('hidden');
        } else {
            origFixedCodeBlock.classList.add('hidden');
        }

        origStatus.textContent = origB.success ? 'Success' : 'Failed';
        origStatus.className = `value badge ${origB.success ? 'success' : 'error'}`;
        
        origOutput.textContent = origB.success ? origB.stdout : origB.stderr;
        if (!origOutput.textContent.trim()) origOutput.textContent = '(No output)';
        
        originalResult.classList.remove('hidden');

        // Render Analysis
        document.getElementById('analysisSummary').textContent = data.summary;
        document.getElementById('analysisComplexity').textContent = data.complexity;
        analysisPanel.classList.remove('hidden');

        // Render Proposals
        const template = document.getElementById('proposalTemplate');
        
        data.proposals.forEach(prop => {
            const clone = template.content.cloneNode(true);
            
            clone.querySelector('.proposal-name').textContent = prop.name;
            clone.querySelector('.proposal-description').textContent = prop.description;
            clone.querySelector('.proposal-code').textContent = prop.code;
            
            const bench = prop.benchmark;
            clone.querySelector('.time-badge').textContent = `${bench.execution_time_ms} ms`;
            
            const statusBadge = clone.querySelector('.proposal-status');
            statusBadge.textContent = bench.success ? 'Success' : 'Failed';
            statusBadge.classList.add(bench.success ? 'success' : 'error');

            // Calculate Speedup vs Original
            const diffEl = clone.querySelector('.proposal-diff');
            if (origB.success && bench.success && origB.execution_time_ms > 0) {
                const diffMs = origB.execution_time_ms - bench.execution_time_ms;
                const ratio = (origB.execution_time_ms / bench.execution_time_ms).toFixed(1);
                
                if (diffMs > 0) {
                    diffEl.textContent = `${ratio}x faster (-${diffMs.toFixed(2)}ms)`;
                    diffEl.classList.add('faster');
                } else if (diffMs < 0) {
                    diffEl.textContent = `${ratio}x slower (+${Math.abs(diffMs).toFixed(2)}ms)`;
                    diffEl.classList.add('slower');
                } else {
                    diffEl.textContent = 'No change';
                }
            } else {
                diffEl.textContent = 'N/A';
            }

            const outputEl = clone.querySelector('.proposal-output');
            outputEl.textContent = bench.success ? bench.stdout : bench.stderr;
            if (!outputEl.textContent.trim()) outputEl.textContent = '(No output)';

            proposalsContainer.appendChild(clone);
        });
    }
});
