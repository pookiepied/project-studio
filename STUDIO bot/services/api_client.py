import aiohttp
from typing import Dict, Any, Optional
from utils.logger import logger

class APIClient:
    
    def __init__(self, base_url: str, api_key: str):
        if not base_url or not api_key:
            raise ValueError("base_url and api_key are required")
        
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self) -> 'APIClient':
        await self.create_session()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.close_session()
    
    async def create_session(self) -> None:
        if self.session is None or self.session.closed:
            timeout = aiohttp.ClientTimeout(total=300, connect=30, sock_read=60)
            self.session = aiohttp.ClientSession(
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}"
                },
                timeout=timeout
            )
    
    async def close_session(self) -> None:
        if self.session and not self.session.closed:
            await self.session.close()
    
    async def post(self, endpoint: str, data: Dict[str, Any], timeout: int = 60) -> Dict[str, Any]:
        if not self.session or self.session.closed:
            await self.create_session()
        
        url = f"{self.base_url}{endpoint}"
        
        try:
            async with self.session.post(
                url, 
                json=data, 
                timeout=aiohttp.ClientTimeout(total=timeout)
            ) as response:
                if response.content_type == 'application/json':
                    response_data = await response.json()
                else:
                    text = await response.text()
                    logger.error(
                        f"Non-JSON response: {text[:200]}", 
                        error_code="NON_JSON_RESPONSE",
                        extra={"status": response.status}
                    )
                    raise ValueError(f"API returned non-JSON response (status {response.status})")
                
                if response.status != 200:
                    error_msg = response_data.get('error', {}).get('message', 'Unknown error')
                    logger.error(
                        f"API error: {error_msg}", 
                        error_code="API_ERROR",
                        extra={"status": response.status}
                    )
                    raise ValueError(f"API error ({response.status}): {error_msg}")
                
                return response_data
        except aiohttp.ClientError as e:
            logger.error(f"API client error: {e}", error_code="API_CLIENT_ERROR")
            raise
        except ValueError:
            raise
        except Exception as e:
            logger.error(f"Unexpected API error: {e}", error_code="API_UNEXPECTED_ERROR")
            raise
