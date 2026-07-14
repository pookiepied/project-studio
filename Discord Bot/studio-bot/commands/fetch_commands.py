import discord
from discord import app_commands
from typing import Optional
from datetime import datetime, timedelta, timezone
from services.memory_service import MemoryService
from services.chat_service import ChatService
from utils.logger import logger
from utils.message_parser import MessageParser

class FetchCommands:
    
    def __init__(
        self, 
        bot: discord.Client, 
        memory_service: MemoryService,
        chat_service: ChatService = None
    ):
        self.bot = bot
        self.memory_service = memory_service
        self.chat_service = chat_service
        self.tree = app_commands.CommandTree(bot)
        self._register_commands()
    
    def _register_commands(self):
        @self.tree.command(
            name="fetch",
            description="Fetch previous messages and optionally ask AI to analyze them"
        )
        @app_commands.describe(
            count="Number of messages to fetch (max 100)",
            prompt="Ask AI to do something with fetched messages (optional)",
            username="Filter by specific username (optional)",
            date="Filter by date: 'today', 'yesterday', or 'YYYY-MM-DD' (optional)"
        )
        async def fetch_messages(
            interaction: discord.Interaction,
            count: int = 20,
            prompt: Optional[str] = None,
            username: Optional[str] = None,
            date: Optional[str] = None
        ):
            await self._handle_fetch(interaction, count, prompt, username, date)
    
    async def _handle_fetch(
        self,
        interaction: discord.Interaction,
        count: int,
        prompt: Optional[str],
        username: Optional[str],
        date: Optional[str]
    ):
        if count < 1:
            await interaction.response.send_message(
                "Error: Count must be at least 1",
                ephemeral=True
            )
            return
        
        if count > 100:
            await interaction.response.send_message(
                "Error: Maximum 100 messages allowed per fetch",
                ephemeral=True
            )
            return
        
        await interaction.response.defer(ephemeral=True)
        
        try:
            target_date = None
            if date:
                target_date = self._parse_date(date)
                if target_date is None:
                    error_msg = self._get_date_error(date)
                    await interaction.followup.send(error_msg, ephemeral=True)
                    return
            
            fetched_messages = []
            total_checked = 0
            fetch_limit = count * 3 if (username or date) else count
            fetch_limit = min(fetch_limit, 500)
            
            try:
                async for message in interaction.channel.history(limit=fetch_limit):
                    total_checked += 1
                    
                    if message.author.bot:
                        continue
                    
                    if not message.content or message.content.strip() == "":
                        continue
                    
                    if username and message.author.name.lower() != username.lower():
                        continue
                    
                    if target_date and message.created_at.date() != target_date:
                        continue
                    
                    fetched_messages.append({
                        "username": message.author.name,
                        "content": message.content,
                        "timestamp": message.created_at.replace(tzinfo=timezone.utc).isoformat(),
                        "author_id": str(message.author.id)
                    })
                    
                    if len(fetched_messages) >= count:
                        break
            
            except discord.Forbidden:
                await interaction.followup.send(
                    "Error: Missing permissions to read message history in this channel",
                    ephemeral=True
                )
                return
            except discord.HTTPException as e:
                logger.error(
                    f"Discord API error during fetch: {e}",
                    error_code="DISCORD_FETCH_ERROR"
                )
                await interaction.followup.send(
                    "Error: Failed to fetch messages from Discord. Please try again.",
                    ephemeral=True
                )
                return
            
            if not fetched_messages:
                error_msg = self._get_no_messages_error(count, username, date)
                await interaction.followup.send(error_msg, ephemeral=True)
                return
            
            channel_id = str(interaction.channel.id)
            for msg in reversed(fetched_messages):
                self.memory_service.add_message(
                    channel_id,
                    "user",
                    msg["content"],
                    timestamp=msg["timestamp"],
                    username=msg["username"]
                )
            
            filter_desc = self._build_filter_description(username, date)
            response = f"Fetched {len(fetched_messages)} message(s){filter_desc}\n"
            response += f"Checked {total_checked} total messages\n"
            
            if prompt:
                if not self.chat_service:
                    await interaction.followup.send(
                        "Error: AI service not available",
                        ephemeral=True
                    )
                    return
                
                response += f"Processing AI request..."
                await interaction.followup.send(response, ephemeral=True)
                
                await self._process_ai_request(
                    interaction.channel,
                    channel_id,
                    prompt,
                    interaction.user.name
                )
            else:
                response += "Added to conversation context"
                await interaction.followup.send(response, ephemeral=True)
            

        
        except Exception as e:
            logger.error(
                f"Fetch command error: {e}",
                user_id=str(interaction.user.id),
                error_code="FETCH_ERROR"
            )
            await interaction.followup.send(
                f"Error: An unexpected error occurred. Please try again.",
                ephemeral=True
            )
    
    async def _process_ai_request(
        self,
        channel,
        channel_id: str,
        prompt: str,
        username: str
    ):
        try:
            context_messages = await self.memory_service.build_context(channel, self.bot.user)
            
            now = datetime.now(timezone.utc)
            timestamp = now.isoformat()
            
            self.memory_service.add_message(
                channel_id,
                "user",
                prompt,
                timestamp=timestamp,
                username=username
            )
            
            context_messages.append({
                "role": "user",
                "content": prompt,
                "timestamp": timestamp,
                "username": username
            })
            
            is_dm = isinstance(channel, discord.DMChannel)
            response_text = await self.chat_service.send_chat_request(
                context_messages, username, is_dm=is_dm
            )
            
            self.memory_service.add_message(channel_id, "assistant", response_text)
            
            chunks = MessageParser.split_long_message(response_text)
            for chunk in chunks:
                await channel.send(chunk)
        
        except Exception as e:
            logger.error(
                f"AI request processing error: {e}",
                error_code="AI_REQUEST_ERROR"
            )
            await channel.send(
                "Error: Failed to process AI request. Please try again."
            )
    
    def _parse_date(self, date_str: str) -> Optional[datetime.date]:
        date_str = date_str.lower().strip()
        now = datetime.now(timezone.utc)
        
        if date_str == "today":
            return now.date()
        elif date_str == "yesterday":
            return (now - timedelta(days=1)).date()
        else:
            try:
                parsed_date = datetime.fromisoformat(date_str).date()
                
                if parsed_date > now.date():
                    return None
                
                two_years_ago = now.date() - timedelta(days=730)
                if parsed_date < two_years_ago:
                    return None
                
                return parsed_date
            except ValueError:
                return None
    
    def _get_date_error(self, date_str: str) -> str:
        try:
            parsed = datetime.fromisoformat(date_str.lower().strip()).date()
            now = datetime.now(timezone.utc).date()
            if parsed > now:
                return f"Error: Date '{date_str}' is in the future. Cannot fetch future messages."
            else:
                return f"Error: Date '{date_str}' is too old (max 2 years ago)."
        except ValueError:
            return (
                f"Error: Invalid date format '{date_str}'\n\n"
                f"Valid formats:\n"
                f"- 'today'\n"
                f"- 'yesterday'\n"
                f"- 'YYYY-MM-DD' (e.g., 2026-03-22)"
            )
    
    def _get_no_messages_error(
        self,
        count: int,
        username: Optional[str],
        date: Optional[str]
    ) -> str:
        filter_desc = self._build_filter_description(username, date)
        error_msg = f"Error: No messages found{filter_desc}\n\n"
        
        if username and date:
            error_msg += (
                f"Suggestions:\n"
                f"- Check if username '{username}' is spelled correctly\n"
                f"- Try without date filter: /fetch count:{count} username:{username}\n"
                f"- Try without username filter: /fetch count:{count} date:{date}"
            )
        elif username:
            error_msg += (
                f"Suggestions:\n"
                f"- Check if username '{username}' exists in this channel\n"
                f"- Username is case-insensitive but must match exactly\n"
                f"- Try increasing count: /fetch count:100 username:{username}"
            )
        elif date:
            error_msg += (
                f"Suggestions:\n"
                f"- No messages found from {date}\n"
                f"- Try a different date\n"
                f"- Try without date filter: /fetch count:{count}"
            )
        else:
            error_msg += (
                f"Suggestions:\n"
                f"- Channel may be empty or have no recent messages\n"
                f"- All recent messages may be from bots or contain only attachments\n"
                f"- Try a different channel"
            )
        
        return error_msg
    
    def _build_filter_description(
        self,
        username: Optional[str],
        date: Optional[str]
    ) -> str:
        filters = []
        
        if username:
            filters.append(f"from user '{username}'")
        if date:
            filters.append(f"from {date}")
        
        if filters:
            return " " + " and ".join(filters)
        return ""
    
    async def sync_commands(self):
        try:
            return await self.tree.sync()
        except Exception as e:
            logger.error(f"Failed to sync commands: {e}", error_code="COMMAND_SYNC_ERROR")
            raise
