from typing import Dict, Any, Optional
import asyncio
import os
import yaml
from pathlib import Path
from dotenv import load_dotenv

from bot.client import create_bot_client
from bot.events import EventHandler
from handlers.message_handler import MessageHandler
from handlers.chat_handler import ChatHandler
from services.api_client import APIClient
from services.chat_service import ChatService
from services.memory_service import MemoryService
from utils.queue_manager import QueueManager
from utils.whitelist_manager import whitelist_manager
from utils.logger import logger
from commands.fetch_commands import FetchCommands

def load_config() -> Dict[str, Any]:
    config_path = Path("config/bot_config.yaml")
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        return config
    except Exception as e:
        logger.error(f"Failed to load configuration: {e}", error_code="CONFIG_LOAD_ERROR")
        raise

async def main() -> None:
    load_dotenv()
    config = load_config()
    
    discord_token = os.getenv('DISCORD_BOT_TOKEN')
    api_key = os.getenv('API_KEY')
    api_base_url = os.getenv('API_BASE_URL', config['api']['base_url'])
    
    if not discord_token:
        logger.error("DISCORD_BOT_TOKEN not found", error_code="MISSING_TOKEN")
        raise ValueError("DISCORD_BOT_TOKEN environment variable is required")
    
    if not api_key:
        logger.error("API_KEY not found", error_code="MISSING_API_KEY")
        raise ValueError("API_KEY environment variable is required")
    
    api_client = APIClient(api_base_url, api_key)
    await api_client.create_session()
    
    chat_service = ChatService(api_client, config)
    memory_service = MemoryService(
        window_size=config['memory']['window_size'],
        whitelist_only=config['memory']['whitelist_only'],
        auto_fetch=config['memory'].get('auto_fetch', True),
        auto_fetch_limit=config['memory'].get('auto_fetch_limit', 20)
    )
    
    client = create_bot_client()
    
    queue_manager = QueueManager(
        max_concurrent=config['queue']['max_concurrent'],
        timeout_seconds=config['queue']['timeout_seconds'],
        max_queue_size=config['queue']['max_queue_size']
    )
    
    chat_handler = ChatHandler(None, chat_service, memory_service)
    message_handler = MessageHandler(None, queue_manager, config)
    
    async def process_job(job: Dict[str, Any]) -> None:
        await chat_handler.handle_chat(job)
    
    fetch_commands = FetchCommands(client, memory_service, chat_service)
    event_handler = EventHandler(client, message_handler, chat_handler, config, fetch_commands)
    
    await queue_manager.start(process_job)
    whitelist_manager.load()
    
    try:
        logger.info("Connecting to Discord")
        await client.start(discord_token)
    except KeyboardInterrupt:
        logger.info("Shutdown signal received")
    except Exception as e:
        logger.error(f"Fatal error: {e}", error_code="FATAL_ERROR")
        raise
    finally:
        await queue_manager.stop()
        await api_client.close_session()
        if not client.is_closed():
            await client.close()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nShutdown requested by user")
    except Exception as e:
        print(f"\nFatal error: {e}")
        raise
