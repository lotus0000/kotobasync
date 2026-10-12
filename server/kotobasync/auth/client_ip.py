from ipaddress import IPv4Network, IPv6Network, ip_address

from starlette.requests import Request


def client_ip(request: Request, trusted: list[IPv4Network | IPv6Network]) -> str:
    """CF-Connecting-IP is only believed when the TCP peer is our tunnel / docker bridge."""
    peer = request.client.host if request.client else ""
    try:
        addr = ip_address(peer)
    except ValueError:
        return peer
    if any(addr in net for net in trusted):
        forwarded = request.headers.get("cf-connecting-ip", "").strip()
        if forwarded:
            return forwarded
    return peer
