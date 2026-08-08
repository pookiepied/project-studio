import discord

def create_bot_client() -> discord.Client:
    intents = discord.Intents.default()
    intents.message_content = True
    intents.messages = True
    intents.guilds = True
    intents.members = False
    
    return discord.Client(intents=intents)
