import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find workspace root (going up from packages/server/src/scripts)
const rootDir = path.resolve(__dirname, '../../../../');
const envPath = path.join(rootDir, '.env');

const PRICING_SOURCE_URL = 'https://raw.githubusercontent.com/berriai/litellm/main/model_prices_and_context_window.json';

interface LiteLLMPricing {
  [model: string]: {
    input_cost_per_token?: number;
    output_cost_per_token?: number;
    input_cost_per_character?: number;
    output_cost_per_character?: number;
    [key: string]: any;
  };
}

interface BiuroPricing {
  input_per_million_usd: number;
  output_per_million_usd: number;
}

const MODELS_TO_SYNC = [
  'gpt-4o',
  'gpt-4o-mini',
  'anthropic/claude-3-5-sonnet-20241022',
  'anthropic/claude-3-5-sonnet-20240620',
  'anthropic/claude-3-5-haiku-20241022',
  'google/gemini-1.5-pro',
  'google/gemini-1.5-flash',
  'google/gemini-2.0-flash',
  'google/gemini-2.5-flash',
  'google/gemini-3.1-flash',
  'text-embedding-3-small',
];

async function syncPricing() {
  console.log('🔄 Fetching latest LLM pricing from LiteLLM...');
  
  try {
    const { data } = await axios.get<LiteLLMPricing>(PRICING_SOURCE_URL);
    
    const overrides: Record<string, BiuroPricing> = {};
    
    // Process specific models
    for (const modelId of MODELS_TO_SYNC) {
      // Try multiple ways to find the model in the LiteLLM dataset
      const info = data[modelId] || 
                   data[modelId.split('/').pop() || ''] || 
                   Object.values(data).find(v => v.model_name === modelId) ||
                   Object.values(data).find(v => v.model_name === modelId.split('/').pop());
      
      if (info) {
        console.log(`📍 Found pricing for: ${modelId}`);
        // LiteLLM costs are usually "per token", we want "per million tokens"
        const inputPerMillion = (info.input_cost_per_token || 0) * 1_000_000;
        const outputPerMillion = (info.output_cost_per_token || 0) * 1_000_000;
        
        // Clean up the model name for Biuro (e.g. remove "anthropic/" prefix)
        const cleanName = modelId.includes('/') ? modelId.split('/')[1] : modelId;
        
        if (inputPerMillion > 0 || outputPerMillion > 0) {
          overrides[cleanName] = {
            input_per_million_usd: Number(inputPerMillion.toFixed(4)),
            output_per_million_usd: Number(outputPerMillion.toFixed(4)),
          };
        }
      }
    }

    // Manual fallback for very new models not yet in LiteLLM (e.g. Gemini 3.1)
    if (!overrides['gemini-3.1-flash']) {
      console.log('✨ Adding gemini-3.1-flash with estimated prices (fallback)');
      overrides['gemini-3.1-flash'] = {
        input_per_million_usd: 0.1,
        output_per_million_usd: 0.4
      };
    }

    // Add wildcards for runtime defaults (backups)
    if (data['gpt-4o']) {
      overrides['openai*'] = {
        input_per_million_usd: (data['gpt-4o'].input_cost_per_token || 0) * 1_000_000,
        output_per_million_usd: (data['gpt-4o'].output_cost_per_token || 0) * 1_000_000,
      };
    }
    
    if (data['anthropic/claude-3-5-sonnet-20241022']) {
      overrides['claude*'] = {
        input_per_million_usd: (data['anthropic/claude-3-5-sonnet-20241022'].input_cost_per_token || 0) * 1_000_000,
        output_per_million_usd: (data['anthropic/claude-3-5-sonnet-20241022'].output_cost_per_token || 0) * 1_000_000,
      };
    }
    
    const jsonStr = JSON.stringify(overrides);
    console.log('✅ Generated overrides:', jsonStr);

    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf8');
      const regex = /^LLM_PRICING_OVERRIDES=.*$/m;
      
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `LLM_PRICING_OVERRIDES='${jsonStr}'`);
      } else {
        envContent += `\nLLM_PRICING_OVERRIDES='${jsonStr}'\n`;
      }
      
      fs.writeFileSync(envPath, envContent);
      console.log('✅ Updated .env file.');
    } else {
      console.warn('⚠️ .env file not found at', envPath);
    }

  } catch (error) {
    console.error('❌ Failed to sync pricing:', error);
    process.exit(1);
  }
}

syncPricing();
