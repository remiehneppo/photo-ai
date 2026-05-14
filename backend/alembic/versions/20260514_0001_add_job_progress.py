"""add job progress fields

Revision ID: 20260514_0001
Revises: 
Create Date: 2026-05-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260514_0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "jobs" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("jobs")}
    if "progress_percent" not in existing:
        op.add_column("jobs", sa.Column("progress_percent", sa.Integer(), nullable=False, server_default="0"))
        op.alter_column("jobs", "progress_percent", server_default=None)
    if "current_step" not in existing:
        op.add_column("jobs", sa.Column("current_step", sa.Integer(), nullable=True))
    if "total_steps" not in existing:
        op.add_column("jobs", sa.Column("total_steps", sa.Integer(), nullable=True))
    if "eta_seconds" not in existing:
        op.add_column("jobs", sa.Column("eta_seconds", sa.Integer(), nullable=True))
    if "estimated_seconds" not in existing:
        op.add_column("jobs", sa.Column("estimated_seconds", sa.Integer(), nullable=True))
    if "progress_label" not in existing:
        op.add_column("jobs", sa.Column("progress_label", sa.String(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "jobs" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("jobs")}
    for column in ("progress_label", "estimated_seconds", "eta_seconds", "total_steps", "current_step", "progress_percent"):
        if column in existing:
            op.drop_column("jobs", column)
