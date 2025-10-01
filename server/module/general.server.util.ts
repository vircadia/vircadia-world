export const isLocalhostIP = (ip: string) => {
    return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
};

export const isDockerInternalIP = (ip: string) => {
    return (
        ip.startsWith("172.") ||
        ip.startsWith("192.168.") ||
        ip.startsWith("10.") ||
        ip === "::ffff:127.0.0.1"
    );
};

export const isLocalhostOrigin = (origin: string) => {
    return (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("https://localhost:") ||
        origin.startsWith("http://127.0.0.1:") ||
        origin.startsWith("https://127.0.0.1:")
    );
};
