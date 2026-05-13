from datetime import timedelta

from jose import jwt

from app.config import ALGORITHM, SECRET_KEY
from app.models.user import User
from app.services import auth_service


class Query:
    def __init__(self, user):
        self.user = user

    def filter(self, *_args):
        return self

    def first(self):
        return self.user


class Db:
    def __init__(self, user):
        self.user = user

    def query(self, model):
        assert model is User
        return Query(self.user)


def test_password_hash_can_be_verified():
    hashed = auth_service.hash_password("correct horse battery staple")

    assert hashed != "correct horse battery staple"
    assert auth_service.verify_password("correct horse battery staple", hashed)
    assert not auth_service.verify_password("wrong", hashed)


def test_access_token_can_resolve_current_user():
    user = User(id="user-1", email="a@example.com", username="alice", hashed_password="hash")
    token = auth_service.create_access_token({"sub": user.id}, expires_delta=timedelta(minutes=5))

    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

    assert payload["sub"] == "user-1"
    assert auth_service.get_current_user(token=token, db=Db(user)) is user
