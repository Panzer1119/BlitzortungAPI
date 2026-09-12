import * as WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface SocketFactory {
    make(url: string): WebSocket;
}

export interface GeoLocation {
    latitude: number;
    longitude: number;
}

export enum Polarity {
    Negative,
    Positive,
}

export enum Region {
    Unknown = 0,
    Europe = 1,
    Oceania = 2,
    NorthAmerica = 3,
    Asia = 4,
    SouthAmerica = 5,
}

interface RawLocation {
    lat: number;
    lon: number;
    /**
     * altitude in meters.
     */
    alt: number;
}

interface RawDetector extends RawLocation {
    /**
     * Station ID.
     */
    sta: string;
    /**
     * Bitflag.
     */
    status: number;
    /**
     * Delay in nanoseconds.
     */
    time: number;
}

interface RawStrike extends RawLocation {
    /**
     * Unix timestamp in nanoseconds
     */
    time: number;
    /**
     * Polarity, polarity, -1 or +1
     */
    pol: number;
    /**
     * Deviation.
     */
    mds: number;
    /**
     * Max circular gap
     */
    mcg: number;
    /**
     * List of detectors.
     */
    sig: RawDetector[];
    /**
     * In seconds.
     */
    delay: number;
    /**
     * Refers to a region, see http://en.blitzortung.org/compendium.php see section `Access to the raw data`
     */
    region: number;
}

export interface Location extends GeoLocation {
    altitude: number;
}

export interface Detector {
    /**
     * ID.
     */
    id: string;
    location: Location;
    /**
     * Unknown.
     */
    status: number;
}

export interface Strike {
    location: Location;
    time: Date;
    detectors: Detector[];
    delay: number;
    deviation: number;
    polarity: Polarity;
    maxDeviation: number;
    maxCircularGap: number;
    region: Region;
}

export class NotConnectedError extends Error {
    constructor(public readonly client: Client) {
        super('Client not connected');
    }
}

export interface Client {
    on(event: 'data', cb: (strike: Strike) => void): this;
    on(event: 'connect', cb: (socket: WebSocket) => void): this;
    on(event: 'error', cb: (error: Error) => void): this;

    once(event: 'data', cb: (strike: Strike) => void): this;
    once(event: 'connect', cb: (socket: WebSocket) => void): this;
    once(event: 'error', cb: (error: Error) => void): this;

    addListener(event: 'data', cb: (strike: Strike) => void): this;
    addListener(event: 'connect', cb: (socket: WebSocket) => void): this;
    addListener(event: 'error', cb: (error: Error) => void): this;
}

export class Client extends EventEmitter {
    private socket?: WebSocket;

    constructor(private socketFactory: SocketFactory) {
        super();
    }

    public getSocket(): WebSocket | undefined {
        return this.socket;
    }

    /**
     * Connects to the remote API.
     */
    public connect(url = this.generateRandomConnectionUrl()) {
        console.debug('Connecting to ' + url);
        const socket = this.socket = this.socketFactory.make(url);
        socket.on('message', (rawData: string) => {
            this.emit('data', this.buildStrikeData(JSON.parse(this.decode(rawData))));
        });
        socket.on('open', () => {
            this.sendJSON({
                a: 111,
            });
            this.emit('connect', socket);
        });
        socket.on('error', err => this.emit('error', err));
    }

    /**
     * Closes the connection to the remote API and detaches all listeners.
     */
    public close() {
        if (!this.socket) {
            throw new NotConnectedError(this);
        }
        this.socket.close();
        this.removeAllListeners();
    }

    public decode(input: string): string {
        const dictionary: Record<number, string> = {};
        const data: string[] = input.split('');
        let previous: string = data[0];
        let result: string[] = [previous];
        let dictionaryIndex: number = 256;
        for (let i: number = 1; i < data.length; i++) {
            let code: number = data[i].charCodeAt(0);
            let current: string;
            if (code < 256) {
                current = data[i];
            } else if (dictionary[code]) {
                current = dictionary[code];
            } else {
                current = previous + previous.charAt(0);
            }
            result.push(current);
            dictionary[dictionaryIndex++] = previous + current.charAt(0);
            previous = current;
        }
        return result.join('');
    }

    private processRawLocation(location: { lat: number; lon: number; alt: number }): Location {
        return {
            latitude: location.lat,
            longitude: location.lon,
            altitude: location.alt,
        };
    }

    private buildStrikeData(strike: RawStrike): Strike {
        return {
            location: this.processRawLocation(strike),
            deviation: strike.mds,
            delay: strike.delay,
            time: new Date(Math.floor(strike.time / 1e6)),
            detectors: strike.sig.map(rawDec => ({
                id: rawDec.sta,
                location: this.processRawLocation(rawDec),
                status: rawDec.status,
                delay: rawDec.time,
            })),
            polarity: strike.pol > 0 ? Polarity.Positive : Polarity.Negative,
            maxDeviation: strike.mds,
            maxCircularGap: strike.mcg,
            region: 1 <= strike.region && strike.region <= 5 ? <Region>strike.region : Region.Unknown,
        }
    }

    private sendJSON(data: any) {
        this.socket!.send(JSON.stringify(data));
    }

    private generateRandomConnectionUrl() {
        const knownServerIds = [1, 7, 8];
        return `wss://ws${knownServerIds[Math.floor(Math.random() * knownServerIds.length)]}.blitzortung.org/`;
    }
}
