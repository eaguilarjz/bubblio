angular.module('starter').factory('Countries', function($resource, RESTFUL_URL) {
   return $resource(
       RESTFUL_URL + '/countries'
   );
});