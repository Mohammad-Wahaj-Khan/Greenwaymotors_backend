import { type Kysely } from 'kysely';
import type { DB } from '../../generated/database.types.js';
type Sort = 'newest' | 'oldest' | 'year_desc' | 'mileage_asc';
export interface VehicleListFilters {
    q?: string | undefined;
    makeId?: number | undefined;
    modelId?: number | undefined;
    bodyTypeId?: number | undefined;
    condition?: 'new' | 'used' | undefined;
    yearMin?: number | undefined;
    yearMax?: number | undefined;
    mileageMax?: number | undefined;
    engineCcMin?: number | undefined;
    engineCcMax?: number | undefined;
    fuel?: string | undefined;
    transmission?: string | undefined;
    drive?: string | undefined;
    steering?: string | undefined;
    seats?: number | undefined;
    doors?: number | undefined;
    exteriorColor?: string | undefined;
    stockCountryId?: number | undefined;
    featureIds: number[];
    sort: Sort;
    cursor?: string | undefined;
    limit: number;
}
export declare class PublicCatalogService {
    private readonly db;
    constructor(db: Kysely<DB>);
    listCountries(region?: string): Promise<{
        id: number;
        iso2: string;
        iso3: string;
        name: string;
        phoneCode: string | null;
        region: string | null;
    }[]>;
    listMakes(): Promise<{
        id: number;
        name: string;
        slug: string;
        logoUrl: string | null;
    }[]>;
    listModels(makeId?: number): Promise<{
        id: number;
        makeId: number;
        name: string;
        slug: string;
    }[]>;
    listBodyTypes(): Promise<{
        id: number;
        name: string;
        slug: string;
    }[]>;
    listFeatures(): Promise<{
        id: number;
        name: string;
        category: string | null;
    }[]>;
    listPublishedVehicles(filters: VehicleListFilters): Promise<{
        data: ({
            referenceNo: string;
            title: string;
            condition: string;
            variant: string | null;
            year: number;
            mileageKm: number | null;
            engineCc: number | null;
            fuel: string | null;
            transmission: string | null;
            drive: string | null;
            steering: string | null;
            seats: number | null;
            doors: number | null;
            exteriorColor: string | null;
            interiorColor: string | null;
            stockCity: string | null;
            make: {
                id: number;
                name: string;
                slug: string;
                logoUrl: string | null;
            };
            model: {
                id: number;
                name: string;
                slug: string;
            };
            bodyType: {
                id: number;
                name: string | null;
                slug: string | null;
            } | null;
            stockCountry: {
                id: number;
                iso2: string;
                iso3: string;
                name: string;
            };
            primaryMedia: {
                id: string;
                type: string | null;
                url: string | null;
                thumbUrl: string | null;
                sortOrder: number | null;
            } | null;
        } | {
            description: string | null;
            referenceNo: string;
            title: string;
            condition: string;
            variant: string | null;
            year: number;
            mileageKm: number | null;
            engineCc: number | null;
            fuel: string | null;
            transmission: string | null;
            drive: string | null;
            steering: string | null;
            seats: number | null;
            doors: number | null;
            exteriorColor: string | null;
            interiorColor: string | null;
            stockCity: string | null;
            make: {
                id: number;
                name: string;
                slug: string;
                logoUrl: string | null;
            };
            model: {
                id: number;
                name: string;
                slug: string;
            };
            bodyType: {
                id: number;
                name: string | null;
                slug: string | null;
            } | null;
            stockCountry: {
                id: number;
                iso2: string;
                iso3: string;
                name: string;
            };
            primaryMedia: {
                id: string;
                type: string | null;
                url: string | null;
                thumbUrl: string | null;
                sortOrder: number | null;
            } | null;
        })[];
        meta: {
            limit: number;
            nextCursor: string | null;
        };
    }>;
    getPublishedVehicle(referenceNo: string): Promise<{
        media: {
            id: string;
            type: "image" | "video";
            url: string;
            thumbUrl: string | null;
            sortOrder: number;
            isPrimary: boolean;
        }[];
        features: {
            id: number;
            name: string;
            category: string | null;
        }[];
        referenceNo: string;
        title: string;
        condition: string;
        variant: string | null;
        year: number;
        mileageKm: number | null;
        engineCc: number | null;
        fuel: string | null;
        transmission: string | null;
        drive: string | null;
        steering: string | null;
        seats: number | null;
        doors: number | null;
        exteriorColor: string | null;
        interiorColor: string | null;
        stockCity: string | null;
        make: {
            id: number;
            name: string;
            slug: string;
            logoUrl: string | null;
        };
        model: {
            id: number;
            name: string;
            slug: string;
        };
        bodyType: {
            id: number;
            name: string | null;
            slug: string | null;
        } | null;
        stockCountry: {
            id: number;
            iso2: string;
            iso3: string;
            name: string;
        };
        primaryMedia: {
            id: string;
            type: string | null;
            url: string | null;
            thumbUrl: string | null;
            sortOrder: number | null;
        } | null;
    } | {
        media: {
            id: string;
            type: "image" | "video";
            url: string;
            thumbUrl: string | null;
            sortOrder: number;
            isPrimary: boolean;
        }[];
        features: {
            id: number;
            name: string;
            category: string | null;
        }[];
        description: string | null;
        referenceNo: string;
        title: string;
        condition: string;
        variant: string | null;
        year: number;
        mileageKm: number | null;
        engineCc: number | null;
        fuel: string | null;
        transmission: string | null;
        drive: string | null;
        steering: string | null;
        seats: number | null;
        doors: number | null;
        exteriorColor: string | null;
        interiorColor: string | null;
        stockCity: string | null;
        make: {
            id: number;
            name: string;
            slug: string;
            logoUrl: string | null;
        };
        model: {
            id: number;
            name: string;
            slug: string;
        };
        bodyType: {
            id: number;
            name: string | null;
            slug: string | null;
        } | null;
        stockCountry: {
            id: number;
            iso2: string;
            iso3: string;
            name: string;
        };
        primaryMedia: {
            id: string;
            type: string | null;
            url: string | null;
            thumbUrl: string | null;
            sortOrder: number | null;
        } | null;
    }>;
    private ordering;
    private cursorCondition;
    private cursorFor;
}
export {};
