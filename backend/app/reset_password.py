"""Reset the admin password from the command line.

    python -m app.reset_password                    # generates one
    python -m app.reset_password --password mine123 # sets your own
    python -m app.reset_password --list             # who has an account

There is no "forgot password" email, because a league app that sends mail is
a mail pipeline to maintain for one evening a season. Anyone who can run this
already has the server and the database, so nothing is lost by keeping the
recovery here rather than in an inbox.
"""

import argparse
import secrets
import sys

from .database import SessionLocal
from .models import User
from .security import hash_password

ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def generate(length: int = 12) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def main() -> int:
    parser = argparse.ArgumentParser(description="Reset an account password.")
    parser.add_argument("--email", help="which account; defaults to the first admin")
    parser.add_argument("--password", help="the new password; generated when omitted")
    parser.add_argument("--list", action="store_true", help="list accounts and exit")
    parser.add_argument(
        "--new-email",
        help="also change the account's address, which is the login id and where reset links go",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.list:
            rows = db.query(User).order_by(User.role, User.email).all()
            if not rows:
                print("No accounts yet. Start the app once to create the first admin.")
                return 0
            for user in rows:
                state = "" if user.is_active else "  (suspended)"
                print(f"{user.role:<6} {user.email}{state}")
            return 0

        if args.email:
            user = db.query(User).filter(User.email == args.email.strip().lower()).first()
        else:
            user = db.query(User).filter(User.role == "admin").order_by(User.id).first()

        if not user:
            print("No matching account. Run with --list to see what exists.", file=sys.stderr)
            return 1

        if args.new_email:
            address = args.new_email.strip().lower()
            clash = db.query(User).filter(User.email == address, User.id != user.id).first()
            if clash:
                print("Another account already uses that address.", file=sys.stderr)
                return 1
            print(f"Address changed from {user.email} to {address}")
            user.email = address

        password = (args.password or "").strip() or generate()
        if len(password) < 6:
            print("Passwords need at least six characters.", file=sys.stderr)
            return 1

        user.hashed_password = hash_password(password)
        user.is_active = True
        db.commit()

        print(f"\nAccount : {user.email}")
        print(f"Password: {password}\n")
        print("Sign in at /admin/login. Change it afterwards if you'd rather pick your own.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
