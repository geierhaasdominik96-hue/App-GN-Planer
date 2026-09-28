import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

function interfaceScore(name) {
  if (/^(wlan|wi-?fi|wireless)$/i.test(name)) return 300;
  if (/^(ethernet|lan-verbindung)$/i.test(name)) return 250;
  if (/wlan|wi-?fi|wireless/i.test(name)) return 200;
  if (/ethernet/i.test(name)) return 150;
  return 50;
}

const candidates = Object.entries(networkInterfaces())
  .filter(([name]) => !/loopback|vethernet|wsl|docker|hyper-v/i.test(name))
  .flatMap(([name, addresses]) => (addresses ?? []).map((address) => ({ name, ...address })))
  .filter((entry) => entry.family === "IPv4" && !entry.internal && isIP(entry.address) === 4)
  .filter((entry) => !entry.address.startsWith("127.") && !entry.address.startsWith("169.254."))
  .sort((left, right) => interfaceScore(right.name) - interfaceScore(left.name));

if (candidates[0]) process.stdout.write(candidates[0].address);
