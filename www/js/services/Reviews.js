angular.module('starter').factory('Reviews', function($resource, RESTFUL_URL) {
    return $resource(RESTFUL_URL + '/reviews/:site_id');
});