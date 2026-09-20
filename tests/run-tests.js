const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function eventStub() {
    return { addListener() {}, removeListener() {} };
}

function testHostSelection() {
    const source = [
        fs.readFileSync(path.join(root, 'host-config.js'), 'utf8'),
        fs.readFileSync(path.join(root, 'background.js'), 'utf8'),
        'globalThis.testApi = { buildDownloadChoices, chooseDownload, qualityOrder };'
    ].join('\n');
    const sandbox = {
        console,
        URL,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        crypto: require('node:crypto').webcrypto,
        importScripts() {},
        chrome: {
            runtime: { onMessage: eventStub(), onStartup: eventStub(), sendMessage: async () => {} },
            tabs: { onCreated: eventStub(), onUpdated: eventStub() },
            downloads: { onCreated: eventStub(), onChanged: eventStub() },
            storage: { local: {} },
            action: {},
            notifications: {}
        }
    };
    vm.runInNewContext(source, sandbox, { filename: 'background.bundle.js' });
    const { buildDownloadChoices, qualityOrder } = sandbox.testApi;
    const downloads = [
        { quality: 'FHD', host: 'workupload' },
        { quality: 'FHD', host: 'mediafire' },
        { quality: 'HD', host: 'gofile' },
        { quality: 'HD', host: 'send' }
    ];

    assert.deepEqual([...qualityOrder('FHD', 'lower')], ['FHD', 'HD', 'SD']);
    assert.equal(buildDownloadChoices(downloads, {
        quality: 'FHD', host: 'workupload', fallbackMode: 'strict', hostPriority: []
    }).length, 1, 'strict mode must not silently switch hosts');
    assert.equal(buildDownloadChoices(downloads, {
        quality: 'FHD', host: 'auto', fallbackMode: 'fallback', hostPriority: ['workupload']
    })[0].item.host, 'workupload', 'custom host priority must win');
    assert.equal(buildDownloadChoices(downloads, {
        quality: 'HD', host: 'send', fallbackMode: 'strict', hostPriority: []
    })[0].item.host, 'send', 'manual Send must be selectable explicitly');
    assert.equal(buildDownloadChoices(downloads, {
        quality: 'HD', host: 'auto', fallbackMode: 'fallback', hostPriority: []
    }).some(choice => choice.item.host === 'send'), false, 'automatic mode must skip manual hosts');
}

function testExtensionReferences() {
    const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
    const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
    const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
    const usedIds = [...popup.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
    const missingIds = [...new Set(usedIds.filter(id => !ids.has(id)))];
    assert.deepEqual(missingIds, [], `popup.js references missing elements: ${missingIds.join(', ')}`);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    for (const contentScript of manifest.content_scripts || []) {
        for (const filename of contentScript.js || []) {
            assert.equal(
                fs.existsSync(path.join(root, filename)),
                true,
                `manifest references missing script ${filename}`
            );
        }
    }
}

async function testModernExtraction() {
    const token = 'a'.repeat(64);
    const requests = [];
    const sandbox = {
        console,
        URL,
        TextEncoder,
        Uint8Array,
        atob: value => Buffer.from(value, 'base64').toString('binary'),
        crypto: require('node:crypto').webcrypto,
        location: {
            hostname: 'witanime.site',
            pathname: '/watch/example-anime/7',
            origin: 'https://witanime.site'
        },
        document: {
            title: 'Episode 7',
            querySelector(selector) {
                if (selector === 'meta[name="csrf-token"]') return { content: 'csrf-value' };
                return null;
            },
            querySelectorAll() { return []; }
        },
        fetch: async (url, options) => {
            requests.push({ url, options });
            return {
                ok: true,
                status: 200,
                async json() {
                    if (String(url).endsWith('/sources')) {
                        return { downloads: { hd: [
                            { token, label: 'MediaFire', version: 'sub', lang: 'ar' },
                            { token: 'bad-token', label: 'Gofile' }
                        ] } };
                    }
                    return {};
                }
            };
        },
        window: {}
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(root, 'anime-content.js'), 'utf8'),
        sandbox,
        { filename: 'anime-content.js' }
    );

    const extracted = await sandbox.window.autoDownloaderExtractEpisode();
    assert.equal(extracted.flow, 'witanime_api');
    assert.equal(extracted.downloads.length, 1, 'invalid tokens must be ignored');
    assert.equal(extracted.downloads[0].host, 'mediafire');
    assert.equal(extracted.downloads[0].quality, 'HD');
    assert.equal(requests[0].url, '/watch/example-anime/7/sources');
    assert.equal(requests[0].options.headers['X-CSRF-TOKEN'], 'csrf-value');

    const gate = await sandbox.window.autoDownloaderPrepareDownload(token);
    assert.equal(gate, `https://witanime.site/watch/download-gate/${token}`);
    assert.equal(requests[1].url, `/watch/download-source/${token}`);
}

(async () => {
    testExtensionReferences();
    testHostSelection();
    await testModernExtraction();
    console.log('All Auto Downloader regression tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
