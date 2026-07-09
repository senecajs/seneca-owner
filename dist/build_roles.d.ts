export type Grant = {
    entity: string;
    ops?: string[];
    spec?: any;
};
export type Role = {
    scope?: string;
    inherits?: any;
    grants?: Grant[];
};
export type Roles = {
    [name: string]: Role;
};
export type BuildRolesOpts = {
    roles: Roles;
    fields: string[];
    ownerfield: string;
};
export type BuildRolesDeps = {
    deep: (...args: any[]) => any;
    Patrun: () => any;
    error: (code: string, details?: any) => Error;
};
export declare function build_roles(opts: BuildRolesOpts, deps: BuildRolesDeps): {
    [name: string]: any;
};
