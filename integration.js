// Integration utilities from reference projects
// Combines bootstrap-llm-provider, API agent patterns, and AI Pipe integration

import { openaiConfig } from './bootstrap-llm-provider-main/bootstrap-llm-provider-main/bootstrap-llm-provider.js';

// Enhanced provider configuration with bootstrap-llm-provider integration
export class ProviderManager {
    constructor() {
        this.config = null;
        this.models = [];
    }
    
    async initialize(options = {}) {
        try {
            // Use bootstrap-llm-provider for advanced configuration
            this.config = await openaiConfig({
                defaultBaseUrls: [
                    "https://aipipe.org/openai/v1",
                    "https://api.openai.com/v1",
                    "https://openrouter.ai/api/v1"
                ],
                show: options.forceShow || false,
                title: "LLM Agent Provider Configuration",
                help: `
                    <div class="alert alert-info">
                        <h6><i class="bi bi-info-circle me-2"></i>Provider Options:</h6>
                        <ul class="mb-0">
                            <li><strong>AI Pipe:</strong> Free tier, no API key required initially</li>
                            <li><strong>OpenAI:</strong> Direct access with your API key</li>
                            <li><strong>OpenRouter:</strong> Access to multiple models</li>
                        </ul>
                    </div>
                `
            });
            
            return this.config;
        } catch (error) {
            console.error('Provider initialization failed:', error);
            throw error;
        }
    }
    
    getEndpoint() {
        return this.config?.baseUrl || 'https://aipipe.org/openai/v1/chat/completions';
    }
    
    getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.config?.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }
        return headers;
    }
    
    getModels() {
        return this.config?.models || ['gpt-4o-mini', 'gpt-4', 'gpt-3.5-turbo'];
    }
}

// Enhanced API integration patterns from apiagent
export class APIConnector {
    constructor() {
        this.baseUrls = {
            google: 'https://www.googleapis.com/customsearch/v1',
            aipipe: 'https://aipipe.org',
            proxy: 'https://aipipe.org/proxy'
        };
    }
    
    // CORS-free fetch using AI Pipe proxy
    async corsFreeFetch(url, options = {}) {
        const proxyUrl = `${this.baseUrls.proxy}/${url}`;
        return fetch(proxyUrl, options);
    }
    
    // Enhanced Google Search with better error handling
    async googleSearch(query, options = {}) {
        const {
            apiKey = 'AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw', // Demo key
            cx = '34be8809e37f44b1f', // Demo search engine
            num = 5,
            start = 1
        } = options;
        
        const searchUrl = `${this.baseUrls.google}?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=${num}&start=${start}`;
        
        try {
            const response = await this.corsFreeFetch(searchUrl);
            const data = await response.json();
            
            if (data.error) {
                throw new Error(`Google Search API error: ${data.error.message}`);
            }
            
            return {
                query,
                totalResults: data.searchInformation?.totalResults || '0',
                searchTime: data.searchInformation?.searchTime || 0,
                results: (data.items || []).map(item => ({
                    title: item.title,
                    link: item.link,
                    snippet: item.snippet,
                    displayLink: item.displayLink
                }))
            };
        } catch (error) {
            console.error('Search failed:', error);
            throw new Error(`Search failed: ${error.message}`);
        }
    }
    
    // AI Pipe integration for advanced workflows
    async aiPipeRequest(endpoint, data, apiKey = null) {
        const url = `${this.baseUrls.aipipe}${endpoint}`;
        const headers = { 'Content-Type': 'application/json' };
        
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`AI Pipe request failed: ${response.status} ${response.statusText}`);
        }
        
        return response.json();
    }
}

// Enhanced tool executor with better error handling and UI integration
export class ToolExecutor {
    constructor(apiConnector, providerManager) {
        this.api = apiConnector;
        this.provider = providerManager;
        this.executionHistory = [];
    }
    
    async executeFunction(toolCall) {
        const startTime = Date.now();
        const { name, arguments: args } = toolCall.function;
        
        try {
            const params = JSON.parse(args);
            let result;
            
            switch (name) {
                case 'google_search':
                    result = await this.api.googleSearch(params.query, {
                        num: params.num_results || 5
                    });
                    break;
                    
                case 'ai_pipe_workflow':
                    result = await this.executeAIPipeWorkflow(params);
                    break;
                    
                case 'execute_javascript':
                    result = await this.executeJavaScript(params);
                    break;
                    
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
            
            const execution = {
                toolCall,
                result,
                duration: Date.now() - startTime,
                timestamp: new Date().toISOString(),
                success: true
            };
            
            this.executionHistory.push(execution);
            return result;
            
        } catch (error) {
            const execution = {
                toolCall,
                error: error.message,
                duration: Date.now() - startTime,
                timestamp: new Date().toISOString(),
                success: false
            };
            
            this.executionHistory.push(execution);
            throw error;
        }
    }
    
    async executeAIPipeWorkflow(params) {
        const { workflow_type, input_data, instructions = '' } = params;
        
        const systemPrompts = {
            analysis: "You are an expert analyst. Provide thorough analysis with insights and recommendations.",
            summarization: "You are an expert summarizer. Create comprehensive yet concise summaries.",
            generation: "You are a creative content generator. Generate high-quality, relevant content.",
            classification: "You are an expert classifier. Classify and categorize data systematically."
        };
        
        const prompt = `${instructions}\n\nTask: ${workflow_type}\nData: ${input_data}`;
        
        const result = await this.api.aiPipeRequest('/openai/v1/chat/completions', {
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompts[workflow_type] },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 1500
        }, this.provider.config?.apiKey);
        
        return {
            workflow_type,
            input_data,
            instructions,
            result: result.choices[0].message.content
        };
    }
    
    async executeJavaScript(params) {
        const { code, return_value = true } = params;
        
        try {
            // Enhanced sandbox with more capabilities
            const sandbox = {
                console: {
                    log: (...args) => this.logOutput('log', args),
                    error: (...args) => this.logOutput('error', args),
                    warn: (...args) => this.logOutput('warn', args),
                    info: (...args) => this.logOutput('info', args)
                },
                Math,
                Date,
                JSON,
                Array,
                Object,
                String,
                Number,
                Boolean
            };
            
            // Reset output buffer
            this.jsOutput = [];
            
            // Create safe execution function
            const func = new Function(
                ...Object.keys(sandbox),
                `
                "use strict";
                const result = (() => {
                    ${code}
                })();
                return result;
                `
            );
            
            // Execute with sandbox
            const result = func(...Object.values(sandbox));
            
            return {
                code,
                result: return_value ? result : null,
                console_output: this.jsOutput,
                success: true,
                execution_time: Date.now()
            };
            
        } catch (error) {
            return {
                code,
                error: error.message,
                console_output: this.jsOutput || [],
                success: false,
                execution_time: Date.now()
            };
        }
    }
    
    logOutput(level, args) {
        if (!this.jsOutput) this.jsOutput = [];
        this.jsOutput.push({
            level,
            message: args.map(arg => 
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' '),
            timestamp: Date.now()
        });
    }
    
    getExecutionStats() {
        const stats = {
            total: this.executionHistory.length,
            successful: this.executionHistory.filter(e => e.success).length,
            failed: this.executionHistory.filter(e => !e.success).length,
            averageDuration: 0,
            toolUsage: {}
        };
        
        if (stats.total > 0) {
            stats.averageDuration = this.executionHistory.reduce((sum, e) => sum + e.duration, 0) / stats.total;
            
            this.executionHistory.forEach(e => {
                const toolName = e.toolCall.function.name;
                stats.toolUsage[toolName] = (stats.toolUsage[toolName] || 0) + 1;
            });
        }
        
        return stats;
    }
}

// Export main integration class
export class LLMAgentIntegration {
    constructor() {
        this.provider = new ProviderManager();
        this.api = new APIConnector();
        this.executor = null;
    }
    
    async initialize(options = {}) {
        await this.provider.initialize(options);
        this.executor = new ToolExecutor(this.api, this.provider);
        return this;
    }
    
    getConfiguration() {
        return {
            provider: this.provider.config,
            models: this.provider.getModels(),
            endpoint: this.provider.getEndpoint(),
            stats: this.executor?.getExecutionStats() || null
        };
    }
}

// Make available globally for the agent
window.LLMAgentIntegration = LLMAgentIntegration;
