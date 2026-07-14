import discord
from typing import Dict, Any, Union, Optional
from services.chat_service import ChatService
from services.memory_service import MemoryService
from utils.logger import logger
from utils.message_parser import MessageParser

class ChatHandler:
    
    def __init__(
        self,
        bot_user: Optional[discord.User],
        chat_service: ChatService,
        memory_service: MemoryService
    ):
        self.bot_user = bot_user
        self.chat_service = chat_service
        self.memory_service = memory_service
    
    async def handle_chat(self, job: Dict[str, Any]) -> None:
        user_id = job['user_id']
        username = job['username']
        channel = job['channel']
        message_content = job['message_content']
        timestamp = job.get('timestamp')
        
        try:
            context_messages = await self.memory_service.build_context(channel, self.bot_user)
            self.memory_service.add_message(
                str(channel.id), 
                "user", 
                message_content, 
                timestamp=timestamp,
                username=username
            )
            context_messages.append({
                "role": "user", 
                "content": message_content,
                "timestamp": timestamp,
                "username": username
            })
            
            is_dm = isinstance(channel, discord.DMChannel)
            response_text = await self.chat_service.send_chat_request(
                context_messages, username, is_dm=is_dm
            )
            
            self.memory_service.add_message(str(channel.id), "assistant", response_text)
            await self._send_response(channel, response_text)
        except Exception as e:
            logger.error(f"Chat handler error: {e}", user_id=user_id, error_code="CHAT_HANDLER_ERROR")
            await channel.send("The STUDIO service is currently unavailable. Please try again shortly.")
    
    async def _send_response(
        self, 
        channel: Union[discord.TextChannel, discord.DMChannel], 
        content: str
    ) -> None:
        try:
            chunks = MessageParser.split_long_message(content)
            for chunk in chunks:
                await channel.send(chunk)
        except discord.Forbidden:
            logger.error(
                "No permission to send message", 
                error_code="SEND_PERMISSION_ERROR",
                channel_id=str(channel.id)
            )
        except discord.HTTPException as e:
            logger.error(
                f"Discord HTTP error: {e}", 
                error_code="DISCORD_HTTP_ERROR",
                channel_id=str(channel.id)
            )
        except Exception as e:
            logger.error(
                f"Failed to send response: {e}", 
                error_code="SEND_MESSAGE_ERROR",
                channel_id=str(channel.id)
            )
