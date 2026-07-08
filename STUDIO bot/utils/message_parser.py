import re
from typing import List
import discord

class MessageParser:
    
    @staticmethod
    def is_bot_mentioned(message: discord.Message, bot_user: discord.User) -> bool:
        return bot_user in message.mentions
    
    @staticmethod
    def extract_content_without_mention(message: discord.Message, bot_user: discord.User) -> str:
        content = message.content
        mention_pattern = f"<@!?{bot_user.id}>"
        content = re.sub(mention_pattern, "", content).strip()
        return content
    
    @staticmethod
    def sanitize_content(content: str, max_length: int = 4000) -> str:
        """Sanitize user input to prevent injection attacks and limit length."""
        if not content:
            return ""
        
        # Truncate to max length
        content = content[:max_length]
        
        # Remove null bytes and other control characters except newlines and tabs
        content = ''.join(char for char in content if char == '\n' or char == '\t' or (ord(char) >= 32 and ord(char) != 127))
        
        return content.strip()
    
    @staticmethod
    def split_long_message(content: str, max_length: int = 2000) -> List[str]:
        if len(content) <= max_length:
            return [content]
        
        chunks = []
        lines = content.split('\n')
        current_lines = []
        current_length = 0
        
        for line in lines:
            line_length = len(line) + 1
            
            if len(line) > max_length:
                if current_lines:
                    chunks.append('\n'.join(current_lines))
                    current_lines = []
                    current_length = 0
                
                words = line.split(' ')
                word_chunk = []
                word_length = 0
                
                for word in words:
                    word_len = len(word) + 1
                    if word_length + word_len > max_length:
                        if word_chunk:
                            chunks.append(' '.join(word_chunk))
                        word_chunk = [word]
                        word_length = len(word)
                    else:
                        word_chunk.append(word)
                        word_length += word_len
                
                if word_chunk:
                    chunks.append(' '.join(word_chunk))
            elif current_length + line_length > max_length:
                chunks.append('\n'.join(current_lines))
                current_lines = [line]
                current_length = line_length
            else:
                current_lines.append(line)
                current_length += line_length
        
        if current_lines:
            chunks.append('\n'.join(current_lines))
        
        return chunks
    
    @staticmethod
    def has_empty_content(content: str) -> bool:
        return not content or content.strip() == ""
