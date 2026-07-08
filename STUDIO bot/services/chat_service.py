from typing import List, Dict, Any, Optional
from pathlib import Path
from datetime import datetime, timezone
from services.api_client import APIClient
from utils.logger import logger
import time

class ChatService:
    
    def __init__(self, api_client: APIClient, config: Dict[str, Any]):
        self.api_client = api_client
        self.config = config
        self.chat_endpoint = config['api']['chat_endpoint']
        self.default_model = f"{config['model']['provider']}:{config['model']['model_id']}"
        self.default_temperature = config['model'].get('temperature', 0.7)
        self.system_prompts = self._load_system_prompts()
    
    def _load_system_prompts(self) -> Dict[str, str]:
        prompts = {}
        prompt_dir = Path("config/prompts")
        
        prompt_files = {
            "base": "system_base.txt",
            "language": "system_language.txt",
            "group_chat": "system_group_chat.txt",
            "dm": "system_dm.txt",
            "non_whitelisted": "non_whitelisted.txt"
        }
        
        for key, filename in prompt_files.items():
            filepath = prompt_dir / filename
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    prompts[key] = f.read().strip()
            except Exception:
                prompts[key] = ""
        
        return prompts
    
    def _build_system_prompt(self, discord_username: str, is_dm: bool = False) -> str:
        current_datetime = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        username = discord_username if discord_username else "you"
        
        base_prompt = self.system_prompts['base'].replace('{discord_username}', username)
        base_prompt = base_prompt.replace('{current_datetime}', current_datetime)
        
        context_prompt = self.system_prompts['dm'].replace('{discord_username}', username) if is_dm else self.system_prompts['group_chat']
        
        system_prompt = f"{base_prompt}\n\n{self.system_prompts['language']}\n\n{context_prompt}"
        return system_prompt.strip()
    
    async def send_chat_request(
        self,
        messages: List[Dict[str, str]],
        discord_username: str,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        is_dm: bool = False
    ) -> str:
        model = model or self.default_model
        temperature = temperature or self.default_temperature
        
        system_prompt = self._build_system_prompt(discord_username, is_dm)
        
        clean_messages = []
        for msg in messages:
            content = msg["content"]
            
            if msg["role"] == "user" and "timestamp" in msg and "username" in msg:
                timestamp = msg["timestamp"]
                username = msg["username"]
                formatted_time = timestamp.replace("T", " ").replace("Z", " UTC").split(".")[0]
                content = f"[{formatted_time}] {username}: {content}"
            
            clean_messages.append({"role": msg["role"], "content": content})
        
        api_messages = [{"role": "system", "content": system_prompt}] + clean_messages
        
        payload = {
            "model": model,
            "messages": api_messages,
            "temperature": temperature,
            "stream": False
        }
        
        start_time = time.time()
        
        try:
            response = await self.api_client.post(
                self.chat_endpoint, 
                payload, 
                timeout=self.config['queue']['timeout_seconds']
            )
            
            if 'choices' in response and len(response['choices']) > 0:
                response_text = response['choices'][0]['message']['content']
                return response_text
            else:
                logger.error("Invalid API response format", error_code="INVALID_RESPONSE_FORMAT")
                raise ValueError("Invalid API response format")
        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            logger.error(
                f"Chat request failed: {e}", 
                model=model, 
                latency_ms=latency_ms, 
                error_code="CHAT_REQUEST_ERROR"
            )
            raise
