"""채널 수집기 등록부. 순서 = 리포트에 표시되는 순서."""
from . import naver_home, naver_ranking, nate, google_trends, daum_news, google_news, creator_advisor

REGISTRY = [
    ("naver_home", naver_home),
    ("naver_ranking", naver_ranking),
    ("nate", nate),
    ("google_trends", google_trends),
    ("daum", daum_news),
    ("google_news", google_news),
    ("creator_advisor", creator_advisor),
]
