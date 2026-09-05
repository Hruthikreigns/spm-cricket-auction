"""Sending email.

Only used for password resets. If SMTP isn't configured the message is written
to the log instead of thrown away, so a self-hosted install without a mail
account can still recover an password — the organiser reads the link out of
`docker compose logs api` rather than an inbox.

Sending happens on a background task. A slow or unreachable mail server should
delay nobody: the request that triggers it has already answered.
"""

import logging
import smtplib
from email.message import EmailMessage

from ..config import settings

log = logging.getLogger(__name__)


def send(to: str, subject: str, body: str) -> bool:
    """Returns whether it actually went out over SMTP."""
    if not settings.email_configured:
        log.warning(
            "email is not configured, so this went nowhere:\n"
            "  to      : %s\n  subject : %s\n%s",
            to,
            subject,
            body,
        )
        return False

    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    try:
        if settings.smtp_port == 465:
            server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15)
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
        with server:
            if settings.smtp_starttls and settings.smtp_port != 465:
                server.starttls()
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(message)
        log.info("sent %r to %s", subject, to)
        return True
    except Exception as exc:  # noqa: BLE001
        # Never surface the reason to the caller: whether an address exists,
        # and whether mail is working, are both things a stranger shouldn't
        # learn from a login page.
        log.exception("could not send mail to %s: %s", to, exc)
        return False


def reset_email(name: str, link: str, minutes: int) -> tuple[str, str]:
    subject = "Reset your SPM Cricket Auction password"
    body = (
        f"Hello {name},\n\n"
        "Someone asked to reset the password for your SPM Cricket Auction account.\n"
        "Open this link to choose a new one:\n\n"
        f"  {link}\n\n"
        f"The link works once and expires in {minutes} minutes.\n\n"
        "If this wasn't you, ignore this message — nothing has changed and your\n"
        "current password still works.\n"
    )
    return subject, body
