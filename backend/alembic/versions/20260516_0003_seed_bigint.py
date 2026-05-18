"""seed column int to bigint

Revision ID: 20260516_0003
Revises: 20260516_0002
Create Date: 2026-05-16 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260516_0003"
down_revision: Union[str, Sequence[str], None] = "20260516_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "jobs" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("jobs")}
    if "seed" not in existing:
        return
    op.alter_column("jobs", "seed", type_=sa.BigInteger(), existing_type=sa.Integer(), existing_nullable=True)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "jobs" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("jobs")}
    if "seed" not in existing:
        return
    op.alter_column("jobs", "seed", type_=sa.Integer(), existing_type=sa.BigInteger(), existing_nullable=True)
