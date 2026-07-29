
> @gameserver-panel/frontend@4.32.3 test
> vitest run src/pages/guild/__tests__/GuildOrders.test.tsx src/pages/guild/__tests__/GuildServers.test.tsx


[1m[7m[36m RUN [39m[27m[22m [36mv2.1.9 [39m[90m/home/airxw/gsp/panel/frontend[39m

[90mstderr[2m | src/pages/guild/__tests__/GuildServers.test.tsx[2m > [22m[2mGuildServers[2m > [22m[2m渲染绑定实例与推荐服务器（含在线状态徽章）
[22m[39m[MSW] Error: intercepted a WebSocket connection without a matching event handler:

  • ws://localhost:3000/ws

If you still wish to intercept this unhandled connection, please create an event handler for it.
Read more: https://mswjs.io/docs/websocket

[90mstderr[2m | src/pages/guild/__tests__/GuildOrders.test.tsx[2m > [22m[2mGuildOrders[2m > [22m[2m渲染跨实例订单列表：实例名/状态徽章/金额/领取码
[22m[39m[MSW] Error: intercepted a WebSocket connection without a matching event handler:

  • ws://localhost:3000/ws

If you still wish to intercept this unhandled connection, please create an event handler for it.
Read more: https://mswjs.io/docs/websocket

[90mstderr[2m | src/pages/guild/__tests__/GuildOrders.test.tsx[2m > [22m[2mGuildOrders[2m > [22m[2m点击「已领取」tab 后仅显示已领取订单（API 带 status 过滤）
[22m[39m[MSW] Error: intercepted a WebSocket connection without a matching event handler:

  • ws://localhost:3000/ws

If you still wish to intercept this unhandled connection, please create an event handler for it.
Read more: https://mswjs.io/docs/websocket

[90mstderr[2m | src/pages/guild/__tests__/GuildServers.test.tsx[2m > [22m[2mGuildServers[2m > [22m[2m无绑定实例时展示空态与「立即绑定」入口
[22m[39m[MSW] Error: intercepted a WebSocket connection without a matching event handler:

  • ws://localhost:3000/ws

If you still wish to intercept this unhandled connection, please create an event handler for it.
Read more: https://mswjs.io/docs/websocket

[90mstderr[2m | src/pages/guild/__tests__/GuildServers.test.tsx[2m > [22m[2mGuildServers[2m > [22m[2m点击绑定实例卡片跳转至实例店铺页
[22m[39m[MSW] Error: intercepted a WebSocket connection without a matching event handler:

  • ws://localhost:3000/ws

If you still wish to intercept this unhandled connection, please create an event handler for it.
Read more: https://mswjs.io/docs/websocket

[90mstderr[2m | src/pages/guild/__tests__/GuildServers.test.tsx[2m > [22m[2mGuildServers[2m > [22m[2m点击绑定实例卡片跳转至实例店铺页
[22m[39m[MSW] Error: intercepted a WebSocket connection without a matching event handler:

  • ws://localhost:3000/ws

If you still wish to intercept this unhandled connection, please create an event handler for it.
Read more: https://mswjs.io/docs/websocket

 [32m✓[39m src/pages/guild/__tests__/GuildServers.test.tsx [2m([22m[2m4 tests[22m[2m)[22m[33m 800[2mms[22m[39m
   [33m[2m✓[22m[39m GuildServers[2m > [22m渲染绑定实例与推荐服务器（含在线状态徽章） [33m407[2mms[22m[39m
[90mstderr[2m | src/pages/guild/__tests__/GuildOrders.test.tsx[2m > [22m[2mGuildOrders[2m > [22m[2m复制领取码按钮调用 clipboard 并提示成功
[22m[39m[MSW] Error: intercepted a WebSocket connection without a matching event handler:

  • ws://localhost:3000/ws

If you still wish to intercept this unhandled connection, please create an event handler for it.
Read more: https://mswjs.io/docs/websocket

[90mstderr[2m | src/pages/guild/__tests__/GuildOrders.test.tsx[2m > [22m[2mGuildOrders[2m > [22m[2m无订单时展示空态与「去逛逛」入口
[22m[39m[MSW] Error: intercepted a WebSocket connection without a matching event handler:

  • ws://localhost:3000/ws

If you still wish to intercept this unhandled connection, please create an event handler for it.
Read more: https://mswjs.io/docs/websocket

 [32m✓[39m src/pages/guild/__tests__/GuildOrders.test.tsx [2m([22m[2m5 tests[22m[2m)[22m[33m 884[2mms[22m[39m
   [33m[2m✓[22m[39m GuildOrders[2m > [22m渲染跨实例订单列表：实例名/状态徽章/金额/领取码 [33m417[2mms[22m[39m
   [33m[2m✓[22m[39m GuildOrders[2m > [22m点击「已领取」tab 后仅显示已领取订单（API 带 status 过滤） [33m304[2mms[22m[39m

[2m Test Files [22m [1m[32m2 passed[39m[22m[90m (2)[39m
[2m      Tests [22m [1m[32m9 passed[39m[22m[90m (9)[39m
[2m   Start at [22m 14:25:17
[2m   Duration [22m 5.13s[2m (transform 693ms, setup 770ms, collect 2.36s, tests 1.68s, environment 2.09s, prepare 403ms)[22m

