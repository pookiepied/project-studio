# STUDIO Discord Bot

AI assistant for Discord powered by the STUDIO platform.

## Setup

1. Create virtual environment:
```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

2. Create .env file from template:
```bash
copy .env.example .env
```

3. Edit .env with your credentials:
```
DISCORD_BOT_TOKEN=your_token
API_KEY=your_key
API_BASE_URL=https://api.pookiepied.dev
```

4. Configure whitelist in config/whitelist.yaml:
```yaml
whitelisted_users:
  - user_id: "123456789"
    username: "example_user"
    added_at: "2026-03-22"
```

## Running

Windows: start_bot.bat
Manual: python main.py

## Usage

Server channels: @STUDIO your message
Direct messages: your message

## Slash Commands

/fetch count:50 - Fetch last 50 messages into context
/fetch count:50 prompt:Summarize - Fetch and analyze with AI
/fetch count:30 username:john date:today - Filter by user and date

## Configuration

Edit config/bot_config.yaml:
- memory.window_size - Messages to remember (default: 50)
- memory.auto_fetch - Auto-fetch in new channels (default: true)
- queue.max_concurrent - Concurrent workers (default: 3)
- bot.cooldown_seconds - User cooldown (default: 5)
- model.temperature - Response randomness (default: 0.85)

## Project Structure

```
bot/          Discord client and events
config/       Configuration and prompts
handlers/     Message and chat handlers
services/     API, chat, and memory services
utils/        Logging, parsing, queue, whitelist
commands/     Slash commands
```

## Requirements

- Python 3.8+
- Discord Bot Token
- API Key for OpenAI-compatible endpoint
