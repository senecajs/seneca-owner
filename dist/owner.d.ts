declare function Owner(this: any, options: any): {
    exports: {
        make_spec: (inspec: any) => any;
        casemap: any;
        config: {
            spec: any;
            options: any;
        };
    };
};
declare namespace Owner {
    var intern: {
        deepextend: (a: any, b: any, c: any) => null;
        make_spec: (inspec: any, default_spec: any) => any;
        match: (matching_val: any, check_val: any) => boolean;
        prior: (self: any, msg: any, reply: any, explain: any, expdata: any) => any;
        reply: (self: any, reply: any, result: any, explain: any, expdata: any) => any;
        fail: (self: any, reply: any, fail: any, explain: any, expdata: any) => any;
        resolveFieldNames: (fieldName: string) => string[];
    };
}
export default Owner;
