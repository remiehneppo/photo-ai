from fastapi import HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.user import User
from app.routers import auth
from app.services.auth_service import hash_password


def session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def test_register_normalizes_email_and_username():
    db = session_factory()()

    response = auth.register(
        req=auth.RegisterRequest(email="Creator@Example.COM", username=" creator ", password="password123"),
        db=db,
    )

    user = db.query(User).filter(User.id == response.id).first()
    assert response.email == "creator@example.com"
    assert response.username == "creator"
    assert user.email == "creator@example.com"
    assert user.username == "creator"


def test_register_and_login_preserve_password_whitespace():
    db = session_factory()()

    auth.register(
        req=auth.RegisterRequest(email="creator@example.com", username="creator", password=" password123 "),
        db=db,
    )

    response = auth.login(
        form=OAuth2PasswordRequestForm(username="creator@example.com", password=" password123 "),
        db=db,
    )

    assert response.access_token

    try:
        auth.login(
            form=OAuth2PasswordRequestForm(username="creator@example.com", password="password123"),
            db=db,
        )
    except HTTPException as exc:
        assert exc.status_code == 401
    else:
        raise AssertionError("trimmed password was accepted")


def test_register_rejects_case_insensitive_duplicate_email():
    db = session_factory()()
    db.add(User(id="user-1", email="creator@example.com", username="creator", hashed_password="hash"))
    db.commit()

    try:
        auth.register(
            req=auth.RegisterRequest(email="Creator@Example.COM", username="creator2", password="password123"),
            db=db,
        )
    except HTTPException as exc:
        assert exc.status_code == 400
        assert exc.detail == "Email already registered"
    else:
        raise AssertionError("duplicate email was accepted")


def test_login_matches_email_case_insensitively_for_existing_users():
    db = session_factory()()
    db.add(
        User(
            id="user-1",
            email="Creator@Example.com",
            username="creator",
            hashed_password=hash_password("password123"),
        )
    )
    db.commit()

    response = auth.login(
        form=OAuth2PasswordRequestForm(username="creator@example.COM", password="password123"),
        db=db,
    )

    assert response.access_token
    assert response.token_type == "bearer"


def test_login_accepts_username_identifier():
    db = session_factory()()
    db.add(
        User(
            id="user-1",
            email="creator@example.com",
            username="creator",
            hashed_password=hash_password("password123"),
        )
    )
    db.commit()

    response = auth.login(
        form=OAuth2PasswordRequestForm(username="creator", password="password123"),
        db=db,
    )

    assert response.access_token
