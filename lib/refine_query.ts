/* Copyright (c) 2018-2020 Voxgig and other contributors, MIT License */


export function refine_query(seneca: any, msg: any, queryprop: any, spec: any, owner: any) {
  let q: any = (msg[queryprop] = msg[queryprop] || {})

  // backwards compat
  spec.public = spec.public || { read: {} }
  let public_field = spec.public.read['*']

  // List public data, regardless of ownership fields. Note that the
  // public flag field is in the query, so excludes private data!
  if (null != public_field && true === !!(q[public_field])) {
    return
  }

  for (let owner_field of spec.fields) {
    let enforce_read_perm = spec.read[owner_field] &&
      false === !!(q[spec.public.read[owner_field]])

    if (!enforce_read_perm) continue;

    let owner_value = owner[owner_field]

    if (Array.isArray(owner_value)) {
      if (null == q[owner_field]) {
        q[owner_field] = owner_value // seneca store must support $in-style queries
      } else if (Array.isArray(q[owner_field])) {
        for (let qval of q[owner_field]) {
          if (!owner_value.includes(qval)) {
            seneca.fail('field-values-not-valid', {
              field: owner_field,
              query_val: q[owner_field],
              bad_query_val: qval,
              valid_owner_vals: owner_value
            })
          }
        }

      } else if (!owner_value.includes(q[owner_field])) {
        seneca.fail('field-not-valid', {
          field: owner_field,
          query_val: q[owner_field],
          bad_query_val: q[owner_field],
          valid_owner_vals: owner_value
        })
      }
    } else {
      q[owner_field] = owner_value
    }

    // TODO: purpose not clear
    // remove from query if value is null
    if (null == q[owner_field]) {
      delete q[owner_field]
    }
  }
}
