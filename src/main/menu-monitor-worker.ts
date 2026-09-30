import koffi from 'koffi';
const parentPort = process.parentPort!;

parentPort.once('message', ({ data }: { data: { handle: string } }) => {
  try {
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const mouseProc = koffi.proto('__stdcall', 'intptr_t', ['int', 'uintptr_t', 'void *']);
    const eventProc = koffi.proto('__stdcall', 'void', ['void *', 'uint32_t', 'uintptr_t', 'int32_t', 'int32_t', 'uint32_t', 'uint32_t']);
    const setMouseHook = user32.func('__stdcall', 'SetWindowsHookExW', 'void *', ['int', koffi.pointer(mouseProc), 'void *', 'uint32_t']);
    const nextHook = user32.func('__stdcall', 'CallNextHookEx', 'intptr_t', ['void *', 'int', 'uintptr_t', 'void *']);
    const setEventHook = user32.func('__stdcall', 'SetWinEventHook', 'void *', ['uint32_t', 'uint32_t', 'void *', koffi.pointer(eventProc), 'uint32_t', 'uint32_t', 'uint32_t']);
    const getModule = kernel32.func('__stdcall', 'GetModuleHandleW', 'void *', ['str16']);
    const getForeground = user32.func('__stdcall', 'GetForegroundWindow', 'uintptr_t', []);
    const peekMessage = user32.func('__stdcall', 'PeekMessageW', 'int', ['void *', 'void *', 'uint32_t', 'uint32_t', 'uint32_t']);
    const translateMessage = user32.func('__stdcall', 'TranslateMessage', 'int', ['void *']);
    const dispatchMessage = user32.func('__stdcall', 'DispatchMessageW', 'intptr_t', ['void *']);
    const ownHandle = BigInt(data.handle);
    let foreground = BigInt(getForeground());
    const mouseCallback = koffi.register((code: number, message: number, input: unknown) => {
      try {
        if (code >= 0 && [0x0201, 0x0204, 0x0207, 0x020b].includes(Number(message))) {
          // MSLLHOOKSTRUCT begins with a physical-screen POINT, including other monitors.
          const coords = koffi.decode(input, 'int32_t', 2) as Int32Array;
          parentPort.postMessage({ type: 'mouse-down', x: coords[0], y: coords[1] });
        }
      } finally {
        // Observe input; always forward it to Windows and other applications.
        return nextHook(null, code, message, input);
      }
    }, koffi.pointer(mouseProc));
    const foregroundCallback = koffi.register((_hook: unknown, _event: number, hwnd: number | bigint) => {
      const next = BigInt(hwnd);
      if (next === foreground) return;
      foreground = next;
      if (next !== ownHandle) parentPort.postMessage({ type: 'dismiss' });
    }, koffi.pointer(eventProc));
    const mouseHook = setMouseHook(14, mouseCallback, getModule(null), 0); // WH_MOUSE_LL
    const foregroundHook = setEventHook(3, 3, null, foregroundCallback, 0, 0, 0); // EVENT_SYSTEM_FOREGROUND
    if (!mouseHook || !foregroundHook) throw new Error('Windows 菜单事件监听注册失败');
    const message = Buffer.alloc(process.arch === 'ia32' ? 28 : 48);
    // Win32 hooks need a message pump. Poll messages, not mouse button state, so short clicks are retained.
    setInterval(() => {
      for (let i = 0; i < 32 && peekMessage(message, null, 0, 0, 1); i++) {
        translateMessage(message); dispatchMessage(message);
      }
    }, 8);
    parentPort.postMessage({ type: 'ready' });
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: String(error) });
  }
});
