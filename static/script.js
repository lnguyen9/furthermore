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
        const loadingStageText = document.getElementById('loadingStageText');

        try {
            // Stage 1
            loadingStageText.textContent = 'Step 1: Benchmarking Original Code...';
            const origRes = await fetch('/api/benchmark_original', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, language })
            });
            if (!origRes.ok) throw new Error((await origRes.json()).detail);
            const origData = await origRes.json();
            
            renderOriginalBenchmark(origData);
            const fixedCode = origData.fixed_code || code;

            // Stage 2
            loadingStageText.textContent = 'Step 2: AI Analyzing & Expanding Code...';
            const analysisRes = await fetch('/api/analyze_code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: fixedCode, language })
            });
            if (!analysisRes.ok) throw new Error((await analysisRes.json()).detail);
            const analysisData = await analysisRes.json();
            
            renderAnalysisAndSkeletons(analysisData);

            // Stage 3
            loadingStageText.textContent = 'Step 3: Benchmarking Expansions in Parallel...';
            const proposalPromises = analysisData.proposals.map((prop, idx) => {
                return fetch('/api/benchmark_proposal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: prop.code, language })
                })
                .then(r => r.json())
                .then(benchData => {
                    updateProposalCard(idx, prop, benchData, origData.benchmark);
                });
            });
            
            await Promise.all(proposalPromises);
            
            loadingStageText.textContent = 'Workflow Complete!';
            setTimeout(() => loadingState.classList.add('hidden'), 1000);

        } catch (error) {
            alert(`Error: ${error.message}\nMake sure your GEMINI_API_KEY is set in the backend environment.`);
            loadingState.classList.add('hidden');
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Analyze & Benchmark`;
        }
    });

    function renderOriginalBenchmark(data) {
        const origB = data.benchmark;
        origTime.textContent = origB.execution_time_ms;
        
        const origFixedCodeBlock = document.getElementById('origFixedCodeBlock');
        const origFixedCode = document.getElementById('origFixedCode');
        
        if (data.fixed_code) {
            origFixedCode.textContent = data.fixed_code;
            origFixedCodeBlock.classList.remove('hidden');
        } else {
            origFixedCodeBlock.classList.add('hidden');
        }

        origStatus.textContent = origB.success ? 'Success' : 'Failed';
        origStatus.className = `value badge ${origB.success ? 'success' : 'error'}`;
        
        origOutput.textContent = origB.success ? origB.stdout : origB.stderr;
        if (!origOutput.textContent.trim()) origOutput.textContent = '(No output)';
        
        originalResult.classList.remove('hidden');
    }

    function renderAnalysisAndSkeletons(data) {
        document.getElementById('analysisSummary').textContent = data.summary;
        document.getElementById('analysisComplexity').textContent = data.complexity;
        analysisPanel.classList.remove('hidden');

        const template = document.getElementById('proposalTemplate');
        
        data.proposals.forEach((prop, idx) => {
            const clone = template.content.cloneNode(true);
            const card = clone.querySelector('.proposal-card');
            card.id = `proposal-card-${idx}`;
            
            clone.querySelector('.proposal-name').textContent = prop.name;
            clone.querySelector('.proposal-theory').textContent = prop.theory;
            clone.querySelector('.proposal-benefits').textContent = prop.benefits;
            clone.querySelector('.proposal-drawbacks').textContent = prop.drawbacks;
            clone.querySelector('.proposal-uses').textContent = prop.practical_uses;
            clone.querySelector('.proposal-code').textContent = prop.code;
            
            proposalsContainer.appendChild(clone);
        });
    }

    function updateProposalCard(idx, prop, benchData, origB) {
        const card = document.getElementById(`proposal-card-${idx}`);
        const bench = benchData.benchmark;
        const finalCode = benchData.fixed_code;
        
        card.querySelector('.proposal-code').textContent = finalCode;
        card.querySelector('.proposal-loader').style.display = 'none';
        card.querySelector('.benchmark-data').classList.remove('hidden');
        
        const timeBadge = card.querySelector('.time-badge');
        timeBadge.textContent = `${bench.execution_time_ms} ms`;
        timeBadge.classList.remove('hidden');
        
        const statusBadge = card.querySelector('.proposal-status');
        statusBadge.textContent = bench.success ? 'Success' : 'Failed';
        statusBadge.classList.add(bench.success ? 'success' : 'error');

        const diffEl = card.querySelector('.proposal-diff');
        if (origB.success && bench.success && origB.execution_time_ms > 0 && bench.execution_time_ms > 0) {
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

        const outputEl = card.querySelector('.proposal-output');
        outputEl.textContent = bench.success ? bench.stdout : bench.stderr;
        if (!outputEl.textContent.trim()) outputEl.textContent = '(No output)';
    }
});
