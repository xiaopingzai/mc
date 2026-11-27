// 联机服务器 —— 本地 Node 服务器（server.js）同时提供静态页面 + WebSocket 中继（/relay）
// 局域网：朋友直接打开 http://房主局域网IP:8123/
// 公网：用 cloudflared / nginx 反代到本机 8123，页面里的 wss 会自动使用当前域名
window.NET_CONFIG = {
  rooms: '',
  api: 'api',
  share: '', // 留空 = 使用当前访问地址生成邀请链接（部署到哪个域名就分享哪个域名）
  relay: 'auto', // auto / '/relay' / 'ws://...'；false 关闭中继，退回旧 P2P 直连
};
