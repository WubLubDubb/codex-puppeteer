function stripXmlEnvelope(xml) {
  return xml.replace(/^\s*<xml>/i, "").replace(/<\/xml>\s*$/i, "");
}

export function parseXml(xml) {
  if (typeof xml !== "string" || xml.trim() === "") {
    return {};
  }

  const content = stripXmlEnvelope(xml.trim());
  const result = {};
  const pattern = /<([A-Za-z0-9_]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/\1>/g;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const [, key, cdataValue, rawValue] = match;
    result[key] = (cdataValue ?? rawValue ?? "").trim();
  }

  return result;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildXml(fields, { cdataKeys = [] } = {}) {
  const lines = ["<xml>"];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (cdataKeys.includes(key)) {
      lines.push(`<${key}><![CDATA[${String(value)}]]></${key}>`);
      continue;
    }

    lines.push(`<${key}>${escapeXml(value)}</${key}>`);
  }

  lines.push("</xml>");
  return lines.join("");
}

export function buildWeComTextReply({ toUserName, fromUserName, content, createTime }) {
  return buildXml(
    {
      ToUserName: toUserName,
      FromUserName: fromUserName,
      CreateTime: createTime,
      MsgType: "text",
      Content: content
    },
    {
      cdataKeys: ["ToUserName", "FromUserName", "MsgType", "Content"]
    }
  );
}
