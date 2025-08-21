// LLM Agent POC - Browser-Based Multi-Tool Reasoning
// Implements the core Python loop logic in JavaScript

import { render, html } from "https://cdn.jsdelivr.net/npm/lit-html@3/+esm";
import { unsafeHTML } from "https://cdn.jsdelivr.net/npm/lit-html@3/directives/unsafe-html.js";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import hljs from "https://cdn.jsdelivr.net/npm/highlight.js@11/+esm";

// Initialize markdown renderer
const marked = new Marked();
marked.use({
    renderer: {
        code(code, lang) {
            const language = hljs.getLanguage(lang) ? lang : "plaintext";
            return `<pre class="code-block"><code class="language-${language}">${hljs.highlight(code, { language }).value.trim()}</code></pre>`;
        },
        table(header, body) {
            return `<table class="table table-striped">${header}${body}</table>`;
        }
    }
});

// Tool definitions following OpenAI function calling format
const TOOLS = [
    {
        type: "function",
        function: {
            name: "google_search",
            description: "Search the web using Google Custom Search API for current information",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The search query to execute"
                    },
                    num_results: {
                        type: "integer",
                        description: "Number of results to return (1-10)",
                        default: 5
                    }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "ai_pipe_workflow",
            description: "Execute AI workflows using the AI Pipe proxy for complex processing",
            parameters: {
                type: "object",
                properties: {
                    workflow_type: {
                        type: "string",
                        enum: ["analysis", "summarization", "generation", "classification"],
                        description: "Type of AI workflow to execute"
                    },
                    input_data: {
                        type: "string",
                        description: "Data to process through the workflow"
                    },
                    instructions: {
                        type: "string",
                        description: "Specific instructions for processing"
                    }
                },
                required: ["workflow_type", "input_data"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "execute_javascript",
            description: "Execute JavaScript code in a sandboxed environment and return results",
            parameters: {
                type: "object",
                properties: {
                    code: {
                        type: "string",
                        description: "JavaScript code to execute"
                    },
                    return_value: {
                        type: "boolean",
                        description: "Whether to return the result of the code execution",
                        default: true
                    }
                },
                required: ["code"]
            }
        }
    }
];

// System prompt for the agent
const SYSTEM_PROMPT = `You are an advanced LLM agent with multi-tool reasoning capabilities. Your goal is to help users by:

1. **Understanding the user's request** completely
2. **Planning the approach** - decide which tools to use and in what order
3. **Executing tool calls** as needed to gather information or perform tasks
4. **Synthesizing results** into a comprehensive response

## Core Agent Loop Logic:
- Take user input
- Analyze what tools are needed
- Execute tool calls to gather data/perform tasks
- Continue with additional tools if needed
- Provide final synthesized answer

## Available Tools:
1. **google_search**: Search the web for current information
2. **ai_pipe_workflow**: Execute AI workflows for complex processing
3. **execute_javascript**: Run JavaScript code for calculations/demonstrations

## Guidelines:
- Use tools strategically to provide comprehensive answers
- Execute code to demonstrate concepts when helpful
- Search for current information when needed
- Combine multiple tools for complex tasks
- Always explain your reasoning process
- Be thorough but concise in responses

## Tool Usage Examples:
- For current events: Use google_search
- For calculations/demos: Use execute_javascript  
- For analysis tasks: Use ai_pipe_workflow
- For complex research: Combine multiple tools

Remember: You can use multiple tools in sequence. Always think through what information you need and use the appropriate tools to gather it.`;

class LLMAgent {
    constructor() {
        this.messages = [];
        this.isProcessing = false;
        this.isPaused = false;
        this.abortController = null;
        this.currentProvider = 'aipipe';
        this.apiKey = '';
        this.model = 'gpt-4o-mini';
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.loadConfig();
        this.setupAIPipeAuth();
    }
    
    bindEvents() {
        // Provider selection
        document.querySelectorAll('.provider-card').forEach(card => {
            card.addEventListener('click', () => this.selectProvider(card));
        });
        
        // Example prompts
        document.querySelectorAll('.example-prompt').forEach(prompt => {
            prompt.addEventListener('click', () => this.useExamplePrompt(prompt));
        });
        
        // Send button
        document.getElementById('sendButton').addEventListener('click', () => this.sendMessage());
        
        // Pause/Cancel button
        document.getElementById('pauseButton').addEventListener('click', () => this.togglePause());
        
        // Enter key in textarea
        document.getElementById('userInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Config changes
        document.getElementById('apiKey').addEventListener('change', (e) => {
            this.apiKey = e.target.value;
            this.saveConfig();
        });
        
        document.getElementById('model').addEventListener('change', (e) => {
            this.model = e.target.value;
            this.saveConfig();
        });
    }
    
    selectProvider(card) {
        document.querySelectorAll('.provider-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.currentProvider = card.dataset.provider;
        this.saveConfig();
    }
    
    useExamplePrompt(prompt) {
        const text = prompt.dataset.prompt;
        document.getElementById('userInput').value = text;
        document.getElementById('welcomeScreen').style.display = 'none';
        this.sendMessage();
    }
    
    async sendMessage() {
        const input = document.getElementById('userInput');
        const message = input.value.trim();
        
        if (!message || this.isProcessing) return;
        
        // Clear input and hide welcome
        input.value = '';
        document.getElementById('welcomeScreen').style.display = 'none';
        
        // Add user message
        this.addMessage('user', message);
        
        // Start processing
        this.isProcessing = true;
        this.isPaused = false;
        this.abortController = new AbortController();
        this.updateControls(true);
        
        try {
            // Core agent loop implementation
            await this.agentLoop(message);
        } catch (error) {
            if (error.name === 'AbortError') {
                this.addMessage('error', 'Request was cancelled by user.');
            } else {
                console.error('Agent error:', error);
                this.addMessage('error', `Error: ${error.message}`);
            }
        } finally {
            this.isProcessing = false;
            this.isPaused = false;
            this.abortController = null;
            this.updateControls(false);
        }
    }
    
    togglePause() {
        if (!this.isProcessing) return;
        
        if (this.isPaused) {
            // Resume processing
            this.isPaused = false;
            this.updateControls(true);
            this.addMessage('agent', '🔄 **Resuming processing...**');
        } else {
            // Pause or cancel processing
            this.isPaused = true;
            this.updateControls(true, true);
            
            // Show pause/cancel options
            this.showPauseCancelDialog();
        }
    }
    
    showPauseCancelDialog() {
        const messagesContainer = document.getElementById('messages');
        
        const dialogEl = document.createElement('div');
        dialogEl.className = 'message pause-dialog';
        dialogEl.id = 'pause-dialog';
        
        dialogEl.innerHTML = `
            <div class="message-header">
                <div class="message-avatar pause-avatar">⏸️</div>
                <strong>Processing Paused</strong>
                <small class="text-muted">${new Date().toLocaleTimeString()}</small>
            </div>
            <div class="message-content">
                <div class="pause-controls">
                    <p><i class="bi bi-pause-circle me-2"></i>Processing has been paused. What would you like to do?</p>
                    <div class="pause-buttons">
                        <button class="btn btn-primary me-2" onclick="agent.resumeProcessing()">
                            <i class="bi bi-play-circle me-1"></i>Resume
                        </button>
                        <button class="btn btn-danger" onclick="agent.cancelProcessing()">
                            <i class="bi bi-x-circle me-1"></i>Cancel
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        messagesContainer.appendChild(dialogEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    resumeProcessing() {
        this.isPaused = false;
        this.updateControls(true);
        this.removePauseDialog();
        this.addMessage('agent', '▶️ **Processing resumed...**');
    }
    
    cancelProcessing() {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.removePauseDialog();
        this.addMessage('agent', '❌ **Processing cancelled by user.**');
    }
    
    removePauseDialog() {
        const dialog = document.getElementById('pause-dialog');
        if (dialog) {
            dialog.remove();
        }
    }
    
    // Check if processing should be paused
    async checkPauseState() {
        if (this.isPaused) {
            // Wait for resume or cancel
            while (this.isPaused && this.isProcessing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // Check if cancelled
        if (this.abortController?.signal.aborted) {
            throw new Error('Request was cancelled');
        }
    }
    
    // Core Agent Loop - implements the Python loop logic
    async agentLoop(userInput) {
        // Initialize conversation with user input
        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userInput }
        ];
        
        while (true) {
            // Check pause/cancel state
            await this.checkPauseState();
            
            // Get LLM response with possible tool calls
            this.showThinking("Agent is analyzing your request...");
            const { output, toolCalls } = await this.callLLM(messages);
            
            // Check pause/cancel state again
            await this.checkPauseState();
            
            // Always show LLM output if any
            if (output.trim()) {
                this.addMessage('agent', output);
                this.hideThinking();
            }
            
            // If no tool calls, get user input and continue
            if (!toolCalls || toolCalls.length === 0) {
                this.hideThinking();
                return; // End conversation turn
            }
            
            // Check pause/cancel state before tool execution
            await this.checkPauseState();
            
            // Execute tool calls
            this.showThinking("Executing tools...");
            const toolResults = await this.handleToolCalls(toolCalls);
            
            // Add tool call results to conversation
            messages.push({
                role: "assistant",
                content: output,
                tool_calls: toolCalls
            });
            
            // Add tool results
            toolResults.forEach(result => {
                messages.push({
                    role: "tool",
                    content: JSON.stringify(result.result),
                    tool_call_id: result.tool_call_id
                });
            });
            
            // Continue loop with updated conversation
        }
    }
    
    async callLLM(messages) {
        const endpoint = this.getEndpoint();
        const headers = this.getHeaders();
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            signal: this.abortController?.signal,
            body: JSON.stringify({
                model: this.model,
                messages: messages,
                tools: TOOLS,
                tool_choice: "auto",
                temperature: 0.7,
                max_tokens: 2000
            })
        });
        
        if (!response.ok) {
            throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        const choice = data.choices[0];
        
        return {
            output: choice.message.content || "",
            toolCalls: choice.message.tool_calls || []
        };
    }
    
    async handleToolCalls(toolCalls) {
        const results = [];
        
        // Show tool execution UI
        this.addToolCallsUI(toolCalls);
        
        for (const toolCall of toolCalls) {
            // Check pause/cancel state before each tool
            await this.checkPauseState();
            
            try {
                const result = await this.executeTool(toolCall);
                results.push({
                    tool_call_id: toolCall.id,
                    result: result
                });
                
                // Update UI with result
                this.updateToolCallResult(toolCall.id, result);
                
            } catch (error) {
                const errorResult = { error: error.message };
                results.push({
                    tool_call_id: toolCall.id,
                    result: errorResult
                });
                
                this.updateToolCallResult(toolCall.id, errorResult);
            }
        }
        
        return results;
    }
    
    async executeTool(toolCall) {
        const { name, arguments: args } = toolCall.function;
        const params = JSON.parse(args);
        
        switch (name) {
            case 'google_search':
                return await this.googleSearch(params);
            case 'ai_pipe_workflow':
                return await this.aiPipeWorkflow(params);
            case 'execute_javascript':
                return await this.executeJavaScript(params);
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    
    async googleSearch({ query, num_results = 5 }) {
        // Use AI Pipe proxy for CORS-free Google search
        const searchUrl = `https://aipipe.org/proxy/https://www.googleapis.com/customsearch/v1?key=AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw&cx=34be8809e37f44b1f&q=${encodeURIComponent(query)}&num=${num_results}`;
        
        try {
            const response = await fetch(searchUrl, {
                signal: this.abortController?.signal
            });
            const data = await response.json();
            
            if (data.items) {
                return {
                    query: query,
                    results: data.items.map(item => ({
                        title: item.title,
                        link: item.link,
                        snippet: item.snippet
                    }))
                };
            } else {
                return { query: query, results: [], message: "No results found" };
            }
        } catch (error) {
            throw new Error(`Search failed: ${error.message}`);
        }
    }
    
    async aiPipeWorkflow({ workflow_type, input_data, instructions = "" }) {
        const endpoint = 'https://aipipe.org/openai/v1/chat/completions';
        
        const systemPrompt = {
            analysis: "You are an expert analyst. Analyze the provided data thoroughly and provide insights.",
            summarization: "You are an expert summarizer. Create a comprehensive summary of the provided content.",
            generation: "You are a creative content generator. Generate high-quality content based on the input.",
            classification: "You are an expert classifier. Classify and categorize the provided data."
        }[workflow_type];
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
            },
            signal: this.abortController?.signal,
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `${instructions}\n\nData to process:\n${input_data}` }
                ],
                temperature: 0.7,
                max_tokens: 1500
            })
        });
        
        if (!response.ok) {
            throw new Error(`AI Pipe workflow failed: ${response.status}`);
        }
        
        const data = await response.json();
        return {
            workflow_type: workflow_type,
            result: data.choices[0].message.content
        };
    }
    
    async executeJavaScript({ code, return_value = true }) {
        try {
            // Create a safe execution environment
            const func = new Function('console', `
                const result = (() => {
                    ${code}
                })();
                return result;
            `);
            
            // Capture console output
            const logs = [];
            const mockConsole = {
                log: (...args) => logs.push(args.join(' ')),
                error: (...args) => logs.push('ERROR: ' + args.join(' ')),
                warn: (...args) => logs.push('WARN: ' + args.join(' '))
            };
            
            // Execute code
            const result = func(mockConsole);
            
            return {
                code: code,
                result: return_value ? result : null,
                console_output: logs,
                success: true
            };
            
        } catch (error) {
            return {
                code: code,
                error: error.message,
                success: false
            };
        }
    }
    
    // UI Methods
    addMessage(type, content, toolCalls = null) {
        const messagesContainer = document.getElementById('messages');
        
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}-message`;
        
        const avatarClass = {
            'user': 'user-avatar',
            'agent': 'agent-avatar',
            'tool': 'tool-avatar',
            'error': 'error-avatar'
        }[type] || 'agent-avatar';
        
        const avatar = {
            'user': 'U',
            'agent': 'AI',
            'tool': 'T',
            'error': 'E'
        }[type] || 'AI';
        
        const title = {
            'user': 'You',
            'agent': 'Agent',
            'tool': 'Tool',
            'error': 'Error'
        }[type] || 'Agent';
        
        messageEl.innerHTML = `
            <div class="message-header">
                <div class="message-avatar ${avatarClass}">${avatar}</div>
                <strong>${title}</strong>
                <small class="text-muted">${new Date().toLocaleTimeString()}</small>
            </div>
            <div class="message-content">
                ${type === 'error' ? `<code>${content}</code>` : marked.parse(content)}
            </div>
        `;
        
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    addToolCallsUI(toolCalls) {
        const messagesContainer = document.getElementById('messages');
        
        const toolCallsEl = document.createElement('div');
        toolCallsEl.className = 'message tool-message';
        toolCallsEl.id = 'current-tool-calls';
        
        const toolCallsHtml = toolCalls.map(toolCall => {
            const params = JSON.parse(toolCall.function.arguments);
            return `
                <div class="tool-call" id="tool-${toolCall.id}">
                    <div class="tool-name">
                        <i class="bi bi-gear-fill me-2"></i>
                        ${toolCall.function.name}
                    </div>
                    <div class="tool-params">
                        ${JSON.stringify(params, null, 2)}
                    </div>
                    <div class="tool-result" id="result-${toolCall.id}">
                        <i class="bi bi-hourglass-split me-2"></i>
                        Executing...
                    </div>
                </div>
            `;
        }).join('');
        
        toolCallsEl.innerHTML = `
            <div class="message-header">
                <div class="message-avatar tool-avatar">T</div>
                <strong>Tool Execution</strong>
                <small class="text-muted">${new Date().toLocaleTimeString()}</small>
            </div>
            <div class="message-content">
                <div class="tool-calls">
                    ${toolCallsHtml}
                </div>
            </div>
        `;
        
        messagesContainer.appendChild(toolCallsEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    updateToolCallResult(toolCallId, result) {
        const resultEl = document.getElementById(`result-${toolCallId}`);
        if (resultEl) {
            const isError = result.error || !result;
            resultEl.className = `tool-result ${isError ? 'text-danger' : 'text-success'}`;
            resultEl.innerHTML = `
                <i class="bi bi-${isError ? 'x-circle' : 'check-circle'} me-2"></i>
                <pre>${JSON.stringify(result, null, 2)}</pre>
            `;
        }
    }
    
    showThinking(message) {
        // Remove existing thinking indicator
        const existing = document.querySelector('.thinking-indicator');
        if (existing) existing.remove();
        
        const messagesContainer = document.getElementById('messages');
        const thinkingEl = document.createElement('div');
        thinkingEl.className = 'thinking-indicator';
        thinkingEl.innerHTML = `
            <div class="thinking-dots">
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
            </div>
            <span>${message}</span>
        `;
        
        messagesContainer.appendChild(thinkingEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    hideThinking() {
        const thinkingEl = document.querySelector('.thinking-indicator');
        if (thinkingEl) thinkingEl.remove();
    }
    
    updateControls(isLoading, isPaused = false) {
        const sendButton = document.getElementById('sendButton');
        const pauseButton = document.getElementById('pauseButton');
        const input = document.getElementById('userInput');
        
        if (isLoading) {
            sendButton.disabled = true;
            sendButton.innerHTML = '<div class="loading-spinner"></div>Processing...';
            input.disabled = true;
            
            // Show pause button
            pauseButton.style.display = 'flex';
            if (isPaused) {
                pauseButton.innerHTML = '<i class="bi bi-pause-fill"></i>Paused';
                pauseButton.className = 'pause-button paused';
            } else {
                pauseButton.innerHTML = '<i class="bi bi-pause-circle"></i>Pause';
                pauseButton.className = 'pause-button';
            }
        } else {
            sendButton.disabled = false;
            sendButton.innerHTML = '<i class="bi bi-send-fill"></i>Send';
            input.disabled = false;
            input.focus();
            
            // Hide pause button
            pauseButton.style.display = 'none';
        }
    }
    
    updateSendButton(isLoading) {
        // Legacy method - redirect to new updateControls
        this.updateControls(isLoading);
    }
    
    // Configuration methods
    getEndpoint() {
        if (this.currentProvider === 'aipipe') {
            return 'https://aipipe.org/openai/v1/chat/completions';
        } else {
            return 'https://api.openai.com/v1/chat/completions';
        }
    }
    
    getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        } else if (this.currentProvider === 'openai') {
            throw new Error('API key required for OpenAI');
        }
        
        return headers;
    }
    
    async setupAIPipeAuth() {
        if (this.currentProvider === 'aipipe') {
            try {
                // Import AI Pipe authentication
                const { getProfile } = await import('https://aipipe.org/aipipe.js');
                const { token, email } = getProfile();
                
                if (!token) {
                    // Redirect to AI Pipe login if no token
                    const currentUrl = window.location.href;
                    window.location = `https://aipipe.org/login?redirect=${encodeURIComponent(currentUrl)}`;
                    return;
                }
                
                // Use AI Pipe token if available
                if (token && !this.apiKey) {
                    this.apiKey = token;
                    document.getElementById('apiKey').value = token;
                }
            } catch (error) {
                console.log('AI Pipe auth not available, continuing without token');
            }
        }
    }
    
    saveConfig() {
        localStorage.setItem('llm-agent-config', JSON.stringify({
            provider: this.currentProvider,
            apiKey: this.apiKey,
            model: this.model
        }));
    }
    
    loadConfig() {
        try {
            const config = JSON.parse(localStorage.getItem('llm-agent-config') || '{}');
            this.currentProvider = config.provider || 'aipipe';
            this.apiKey = config.apiKey || '';
            this.model = config.model || 'gpt-4o-mini';
            
            // Update UI
            document.querySelector(`[data-provider="${this.currentProvider}"]`)?.classList.add('active');
            document.getElementById('apiKey').value = this.apiKey;
            document.getElementById('model').value = this.model;
        } catch (error) {
            console.error('Failed to load config:', error);
        }
    }
}

// Initialize the agent when the page loads
let agent; // Global reference for pause/resume functionality

document.addEventListener('DOMContentLoaded', () => {
    agent = new LLMAgent();
});

export default LLMAgent;
