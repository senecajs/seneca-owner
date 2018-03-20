# seneca-owner
[Seneca](senecajs.org) plugin providing messages for a generic key-value store.

[![Npm][BadgeNpm]][Npm]
[![Travis][BadgeTravis]][Travis]
[![Coveralls][BadgeCoveralls]][Coveralls]



## Quick Example

```
Seneca()
  .use('kv')
  .act('role:kv,cmd:set,key:foo,val:bar', function() {
    this.act('role:kv,cmd:get,key:foo', function(ignore, out) {
      console.log(out.val) // prints 'bar'
    })
  })
```


## Inbound Messages

* `role:kv,cmd:set`; params: `key`: string, `val`: object
* `role:kv,cmd:get`; params: `key`: string
* `role:kv,cmd:del`; params: `key`: string


## Implementations

* Self: transient memory store
* Redis: [`seneca-redis-owner`](https://github.com/voxgig/seneca-redis-owner)


[BadgeCoveralls]: https://coveralls.io/repos/voxgig/seneca-owner/badge.svg?branch=master&service=github
[BadgeNpm]: https://badge.fury.io/js/seneca-owner.svg
[BadgeTravis]: https://travis-ci.org/voxgig/seneca-owner.svg?branch=master
[Coveralls]: https://coveralls.io/github/voxgig/seneca-owner?branch=master
[Npm]: https://www.npmjs.com/package/seneca-owner
[Travis]: https://travis-ci.org/voxgig/seneca-owner?branch=master
