import discord
from typing import Dict, Any
from utils.logger import logger

class EventHandler:
    
    def __init__(
        self,
        client: discord.Client,
        message_handler,
        chat_handler,
        config: Dict[str, Any],
        fetch_commands=None
    ):
        self.client = client
        self.message_handler = message_handler
        self.chat_handler = chat_handler
        self.config = config
        self.bot_name = config['bot']['name']
        self.fetch_commands = fetch_commands
        self._register_events()
    
    def _register_events(self):
        handler = self
        
        @self.client.event
        async def on_ready():
            await handler._on_ready()
        
        @self.client.event
        async def on_message(message: discord.Message):
            await handler._on_message(message)
        
        @self.client.event
        async def on_guild_join(guild: discord.Guild):
            await handler._on_guild_join(guild)
        
        @self.client.event
        async def on_error(event: str, *args, **kwargs):
            await handler._on_error(event, *args, **kwargs)
    
    async def _on_ready(self):
        self.message_handler.bot_user = self.client.user
        self.chat_handler.bot_user = self.client.user
        logger.info(f"Bot connected as {self.client.user.name}")
        
        if self.fetch_commands:
            try:
                await self.fetch_commands.sync_commands()
                logger.info("Slash commands synced successfully")
            except Exception as e:
                logger.error(f"Failed to sync commands: {e}", error_code="COMMAND_SYNC_ERROR")
        
        activity = discord.Activity(
            type=discord.ActivityType.listening,
            name=f"@{self.bot_name} mentions"
        )
        await self.client.change_presence(activity=activity)
    
    async def _on_message(self, message: discord.Message):
        try:
            await self.message_handler.handle_message(message)
        except Exception as e:
            logger.error(f"Error handling message: {e}", error_code="MESSAGE_HANDLER_ERROR")
    
    async def _on_guild_join(self, guild: discord.Guild):
        logger.info(f"Bot joined guild: {guild.name}", guild_id=str(guild.id))
    
    async def _on_error(self, event: str, *args, **kwargs):
        logger.error(f"Discord event error: {event}", error_code="DISCORD_EVENT_ERROR")
