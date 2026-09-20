// Send requires the user to complete its verification. Once the user clicks
// the real download control, let external-manager mode advance even when IDM
// intercepts the request before Chrome creates a download item.
document.addEventListener('click', event => {
    const control = event.target?.closest?.('a, button, input[type="button"], input[type="submit"]');
    if (!control) return;
    const description = [
        control.textContent,
        control.value,
        control.getAttribute('download'),
        control.getAttribute('href'),
        control.id,
        control.className
    ].filter(Boolean).join(' ');
    if (!/download|تحميل/i.test(description)) return;
    setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'HOST_DOWNLOAD_TRIGGERED', host: 'send' }).catch(() => {});
    }, 4000);
}, true);
