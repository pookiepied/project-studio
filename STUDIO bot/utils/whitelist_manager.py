import yaml
from pathlib import Path
from typing import Set
from utils.logger import logger

class WhitelistManager:
    
    def __init__(self, config_path: str = "config/whitelist.yaml"):
        self.config_path = Path(config_path)
        self.whitelisted_users: Set[str] = set()
        self.load()
    
    def load(self) -> None:
        try:
            if not self.config_path.exists():
                self.whitelisted_users = set()
                return
            
            with open(self.config_path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)
            
            if data and 'whitelisted_users' in data:
                users = data['whitelisted_users']
                self.whitelisted_users = set()
                
                for user in users:
                    if isinstance(user, dict):
                        user_id = user.get('user_id')
                        if user_id:
                            self.whitelisted_users.add(str(user_id))
                    else:
                        self.whitelisted_users.add(str(user))
            else:
                self.whitelisted_users = set()
        except Exception as e:
            logger.error(f"Failed to load whitelist: {e}", error_code="WHITELIST_LOAD_ERROR")
            self.whitelisted_users = set()
    
    def reload(self) -> None:
        self.load()
    
    def is_whitelisted(self, user_id: str) -> bool:
        return str(user_id) in self.whitelisted_users

whitelist_manager = WhitelistManager()
