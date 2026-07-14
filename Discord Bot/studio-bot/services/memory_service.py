from typing import List, Dict, Any, Union
from collections import defaultdict
from datetime import datetime, timezone
import discord

class MemoryService:
    
    def __init__(
        self, 
        window_size: int, 
        whitelist_only: bool = True,
        auto_fetch: bool = True,
        auto_fetch_limit: int = 20
    ):
        if window_size < 1:
            raise ValueError("window_size must be at least 1")
        
        self.window_size = window_size
        self.whitelist_only = whitelist_only
        self.auto_fetch = auto_fetch
        self.auto_fetch_limit = auto_fetch_limit
        self.memory: Dict[str, List[Dict[str, str]]] = defaultdict(list)
    
    def add_message(
        self, 
        channel_id: str, 
        role: str, 
        content: str, 
        timestamp: str = None,
        username: str = None
    ) -> None:
        message = {
            "role": role, 
            "content": content,
            "timestamp": timestamp or datetime.now(timezone.utc).isoformat()
        }
        
        if username and role == "user":
            message["username"] = username
        
        self.memory[channel_id].append(message)
        
        if len(self.memory[channel_id]) > self.window_size:
            self.memory[channel_id] = self.memory[channel_id][-self.window_size:]
    
    def get_messages(self, channel_id: str) -> List[Dict[str, str]]:
        return self.memory[channel_id].copy()
    
    async def build_context(
        self, 
        channel: Union[discord.TextChannel, discord.DMChannel], 
        bot_user
    ) -> List[Dict[str, str]]:
        from utils.logger import logger
        
        channel_id = str(channel.id)
        
        if channel_id in self.memory and self.memory[channel_id]:
            return self.get_messages(channel_id)
        
        if self.auto_fetch and not isinstance(channel, discord.DMChannel):
            try:
                fetched_count = 0
                messages_to_add = []
                
                async for message in channel.history(limit=self.auto_fetch_limit * 2):
                    if message.author.bot or not message.content or message.content.strip() == "":
                        continue
                    
                    messages_to_add.append({
                        "content": message.content,
                        "timestamp": message.created_at.replace(tzinfo=timezone.utc).isoformat(),
                        "username": message.author.name
                    })
                    
                    fetched_count += 1
                    if fetched_count >= self.auto_fetch_limit:
                        break
                
                # Add messages in reverse order (oldest first)
                for msg in reversed(messages_to_add):
                    self.add_message(
                        channel_id,
                        "user",
                        msg["content"],
                        timestamp=msg["timestamp"],
                        username=msg["username"]
                    )
                
                if fetched_count > 0:
                    logger.info(f"Auto-fetched {fetched_count} messages", channel_id=channel_id)
                    return self.get_messages(channel_id)
            
            except discord.Forbidden:
                logger.warning(f"No permission to read history", channel_id=channel_id, error_code="AUTO_FETCH_FORBIDDEN")
            except Exception as e:
                logger.error(f"Auto-fetch failed: {e}", error_code="AUTO_FETCH_ERROR", channel_id=channel_id)
        
        return []
