const SEVERITY = { info: 'INFO', warn: 'WARNING', error: 'ERROR' };
export function logEvent(level, event, fields = {}) {
    const line = JSON.stringify({ severity: SEVERITY[level], message: event, event, ...fields });
    if (level === 'error')
        console.error(line);
    else if (level === 'warn')
        console.warn(line);
    else
        console.info(line);
}
