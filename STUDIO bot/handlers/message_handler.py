import discord
from typing import Dict, Any, Optional
from datetime import datetime, timedelta, timezone
from utils.logger import logger
from utils.whitelist_manager import whitelist_manager
from utils.message_parser import MessageParser
from utils.queue_manager import QueueManager

class MessageHandler:
    
    MAX_COOLDOWN_ENTRIES = 1000
    
    def __init__(
        self,
        bot_user: Optional[discord.User],
        queue_manager: QueueManager,
        config: Dict[str, Any]
    ):
        self.bot_user = bot_user
        self.queue_manager = queue_manager
        self.config = config
        self.mention_only = config['bot']['mention_only']
        self.cooldown_seconds = config['bot']['cooldown_seconds']
        self.user_cooldowns: Dict[str, datetime] = {}
        self.non_whitelisted_message = self._load_non_whitelisted_message()
    
    def _load_non_whitelisted_message(self) -> str:
        try:
            with open("config/prompts/non_whitelisted.txt", 'r', encoding='utf-8') as f:
                return f.read().strip()
        except Exception:
            return "I can only respond to authorized users."
    
    async def handle_message(self, message: discord.Message) -> bool:
        try:
            if not message or not message.author or not message.channel:
                return False
            
            if not self.bot_user or message.author.id == self.bot_user.id:
                return False
            
            is_dm = isinstance(message.channel, discord.DMChannel)
            
            if not is_dm and self.mention_only:
                if not MessageParser.is_bot_mentioned(message, self.bot_user):
                    return False
            
            user_id = str(message.author.id)
            channel_id = str(message.channel.id)
            guild_id = str(message.guild.id) if message.guild else None
            
            if not whitelist_manager.is_whitelisted(user_id):
                await message.channel.send(self.non_whitelisted_message)
                return True
            
            if self._is_on_cooldown(user_id):
                remaining = self._get_cooldown_remaining(user_id)
                await message.channel.send(f"Please wait {remaining} seconds before sending another request.")
                return True
            
            content = message.content.strip() if is_dm else MessageParser.extract_content_without_mention(message, self.bot_user)
            content = MessageParser.sanitize_content(content)
            
            if MessageParser.has_empty_content(content):
                msg = "Your message appears to be empty. Please send a message to chat with me!" if is_dm else "It looks like your message was empty. Please include a message with your mention."
                await message.channel.send(msg)
                return True
            
            if self.queue_manager.is_full():
                await message.channel.send("The request queue is currently full. Please try again in a moment.")
                return True
            
            job = {
                "user_id": user_id,
                "username": message.author.name,
                "channel_id": channel_id,
                "guild_id": guild_id,
                "message_content": content,
                "channel": message.channel,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            
            enqueued = await self.queue_manager.enqueue(job)
            
            if enqueued:
                self._set_cooldown(user_id)
                return True
            else:
                await message.channel.send("Failed to enqueue your request. Please try again.")
                return False
        except Exception as e:
            logger.error(f"Error in handle_message: {e}", error_code="HANDLE_MESSAGE_ERROR")
            return False
    
    def _is_on_cooldown(self, user_id: str) -> bool:
        if user_id not in self.user_cooldowns:
            return False
        return datetime.now(timezone.utc) < self.user_cooldowns[user_id]
    
    def _get_cooldown_remaining(self, user_id: str) -> int:
        if user_id not in self.user_cooldowns:
            return 0
        remaining = (self.user_cooldowns[user_id] - datetime.now(timezone.utc)).total_seconds()
        return max(0, int(remaining))
    
    def _set_cooldown(self, user_id: str) -> None:
        if len(self.user_cooldowns) > self.MAX_COOLDOWN_ENTRIES:
            self._cleanup_expired_cooldowns()
        
        self.user_cooldowns[user_id] = datetime.now(timezone.utc) + timedelta(seconds=self.cooldown_seconds)
    
    def _cleanup_expired_cooldowns(self) -> None:
        now = datetime.now(timezone.utc)
        expired_users = [uid for uid, expiry in self.user_cooldowns.items() if expiry < now]
        for uid in expired_users:
            del self.user_cooldowns[uid]
