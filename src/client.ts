import {
	CompositeDidDocumentResolver,
	CompositeHandleResolver,
	DohJsonHandleResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	WellKnownHandleResolver
} from '@atcute/identity-resolver';
import {
	type Did,
	type Handle,
} from '@atcute/lexicons';
import { Client, simpleFetchHandler } from '@atcute/client';
// or as an import in your entrypoint
import type {} from '@atcute/atproto';

export type Collection = `${string}.${string}.${string}`;

/**
 * Resolves a handle to a DID using DNS and HTTP methods.
 * @param handle - The handle to resolve (e.g., "alice.bsky.social")
 * @returns The DID associated with the handle
 */
export async function resolveHandle({ handle }: { handle: Handle }) {
	const handleResolver = new CompositeHandleResolver({
		methods: {
			dns: new DohJsonHandleResolver({ dohUrl: 'https://mozilla.cloudflare-dns.com/dns-query' }),
			http: new WellKnownHandleResolver()
		}
	});

	const data = await handleResolver.resolve(handle);
	return data;
}

const didResolver = new CompositeDidDocumentResolver({
	methods: {
		plc: new PlcDidDocumentResolver(),
		web: new WebDidDocumentResolver()
	}
});

/**
 * Gets the PDS (Personal Data Server) URL for a given DID.
 * @param did - The DID to look up
 * @returns The PDS service endpoint URL
 * @throws If no PDS is found in the DID document
 */
export async function getPDS(did: Did) {
	const doc = await didResolver.resolve(did as Did<'plc'> | Did<'web'>);
	if (!doc.service) throw new Error('No PDS found');
	for (const service of doc.service) {
		if (service.id === '#atproto_pds') {
			return service.serviceEndpoint.toString();
		}
	}
}

/**
 * Creates an AT Protocol client for a user's PDS.
 * @param did - The DID of the user
 * @returns A client configured for the user's PDS
 * @throws If the PDS cannot be found
 */
export async function getClient({ did }: { did: Did }) {
	const pds = await getPDS(did);
	if (!pds) throw new Error('PDS not found');

	const client = new Client({
		handler: simpleFetchHandler({ service: pds })
	});

	return client;
}

/**
 * Lists records from a repository collection with pagination support.
 * @param did - The DID of the repository (defaults to current user)
 * @param collection - The collection to list records from
 * @param cursor - Pagination cursor for continuing from a previous request
 * @param limit - Maximum number of records to return (default 100, set to 0 for all records)
 * @param client - The client to use (defaults to user's PDS client)
 * @returns An array of records from the collection
 */
export async function listRecords({
	did,
	collection,
	cursor,
	limit = 100,
	client
}: {
	did: Did;
	collection: `${string}.${string}.${string}`;
	cursor?: string;
	limit?: number;
	client?: Client;
}) {
	if (!collection) {
		throw new Error('Missing parameters for listRecords');
	}
	if (!did) {
		throw new Error('Missing did for getRecord');
	}

	client ??= await getClient({ did });

	const allRecords = [];

	let currentCursor = cursor;
	do {
		const response = await client.get('com.atproto.repo.listRecords', {
			params: {
				repo: did,
				collection,
				limit: !limit || limit > 100 ? 100 : limit,
				cursor: currentCursor
			}
		});

		if (!response.ok) {
			return allRecords;
		}

		allRecords.push(...response.data.records);
		currentCursor = response.data.cursor;
	} while (currentCursor && (!limit || allRecords.length < limit));

	return allRecords;
}
