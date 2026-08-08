/** Tool schema definitions for desktop network tools (connectivity, Wi-Fi, adapters, hosts file). */
export const DESKTOP_NETWORK_DEFINITIONS = [
  // ── Connectivity ───────────────────────────────────────────────────────────
  {
    name: "ping_host",
    description: "Ping a host and return round-trip statistics: sent, received, lost, loss%, avg/min/max ms. Use to check if a host is reachable and measure latency.",
    inputSchema: {
      type: "object",
      properties: {
        host:  { type: "string", description: "Hostname or IP address" },
        count: { type: "number", description: "Number of ping packets (default 4)" },
      },
      required: ["host"],
    },
  },
  {
    name: "check_port",
    description: "Test if a TCP port is open on a host. Returns open: true/false. Use for diagnosing service availability (e.g. port 443 for HTTPS, 22 for SSH, 3306 for MySQL).",
    inputSchema: {
      type: "object",
      properties: {
        host:       { type: "string", description: "Hostname or IP address" },
        port:       { type: "number", description: "TCP port number (1–65535)" },
        timeout_ms: { type: "number", description: "Connection timeout in ms (default 3000)" },
      },
      required: ["host","port"],
    },
  },
  {
    name: "dns_lookup",
    description: "Perform a DNS lookup for a hostname. Returns all DNS records of the given type (A, AAAA, MX, CNAME, TXT, NS, PTR, SRV, SOA).",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", description: "Hostname to look up, or IP for reverse lookup (PTR)" },
        type: { type: "string", enum: ["A","AAAA","MX","CNAME","TXT","NS","PTR","SRV","SOA"], description: "DNS record type (default: A)" },
      },
      required: ["host"],
    },
  },
  {
    name: "traceroute",
    description: "Trace the network path to a host, showing each hop. Uses Test-NetConnection with TraceRoute, falling back to tracert. Returns hop IP addresses and whether the host is reachable.",
    inputSchema: {
      type: "object",
      properties: {
        host:     { type: "string", description: "Target hostname or IP" },
        max_hops: { type: "number", description: "Maximum hops (default 30)" },
      },
      required: ["host"],
    },
  },

  // ── Wi-Fi ──────────────────────────────────────────────────────────────────
  {
    name: "list_wifi_networks",
    description: "Scan and list available Wi-Fi networks: SSID, signal strength %, authentication type, encryption, BSSID list, and whether currently connected.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_wifi_status",
    description: "Get current Wi-Fi connection status: state, SSID, BSSID, signal %, channel, receive/send speed in Mbps.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "connect_wifi",
    description: "Connect to a Wi-Fi network by SSID. If a password is provided, creates a WPA2-PSK profile. For open networks, omit password.",
    inputSchema: {
      type: "object",
      properties: {
        ssid:     { type: "string", description: "Network SSID to connect to" },
        password: { type: "string", description: "WPA2 password (omit for open networks)" },
      },
      required: ["ssid"],
    },
  },
  {
    name: "disconnect_wifi",
    description: "Disconnect from the current Wi-Fi network.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },

  // ── Adapters ───────────────────────────────────────────────────────────────
  {
    name: "list_adapters",
    description: "List all network adapters with status, MAC, speed, current IP, gateway, DNS servers, and whether DHCP is enabled.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "enable_adapter",
    description: "Enable a disabled network adapter by name.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Adapter name (from list_adapters)" } },
      required: ["name"],
    },
  },
  {
    name: "disable_adapter",
    description: "Disable a network adapter by name. Use to block network access for a specific interface.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Adapter name (from list_adapters)" } },
      required: ["name"],
    },
  },
  {
    name: "set_static_ip",
    description: "Assign a static IP address to a network adapter. Removes existing IP configuration first. Optionally set gateway and DNS servers.",
    inputSchema: {
      type: "object",
      properties: {
        name:    { type: "string", description: "Adapter name" },
        ip:      { type: "string", description: "IPv4 address e.g. '192.168.1.100'" },
        prefix:  { type: "number", description: "Subnet prefix length (default 24 = /24 = 255.255.255.0)" },
        gateway: { type: "string", description: "Default gateway IP (optional)" },
        dns:     { type: "array",  items: { type: "string" }, description: "DNS server IPs e.g. ['8.8.8.8','8.8.4.4']" },
      },
      required: ["name","ip"],
    },
  },
  {
    name: "set_dhcp",
    description: "Switch a network adapter back to DHCP (automatic IP) from a static configuration.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Adapter name" } },
      required: ["name"],
    },
  },

  // ── Hosts file ─────────────────────────────────────────────────────────────
  {
    name: "manage_hosts_file",
    description: "Read, add, or remove entries in the Windows hosts file (System32/drivers/etc/hosts). Adding entries requires write access — run elevated if needed.",
    inputSchema: {
      type: "object",
      properties: {
        action:   { type: "string", enum: ["read","add","remove"], description: "Action to perform" },
        ip:       { type: "string", description: "IP address for add action (e.g. '127.0.0.1')" },
        hostname: { type: "string", description: "Hostname for add/remove (e.g. 'mysite.local')" },
      },
      required: ["action"],
    },
  },
] as const;
