angular.module('starter').factory('Review', function($resource, RESTFUL_URL) {
    return $resource(RESTFUL_URL + '/review/:order_id', null, {
        update: {method: 'PUT'}
    });
});