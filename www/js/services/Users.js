angular.module('starter').factory('Users', function($resource, RESTFUL_URL) {
   return $resource(
       RESTFUL_URL + '/users', null, {
            update: {method: 'PUT'}
   });
});