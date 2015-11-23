angular.module('starter').controller('OrdersCtrl', function($scope, $stateParams, Orders, CurrentUser) {
    $scope.userId = CurrentUser.getUserId();
    
    Orders.get({user_id: $scope.userId}, function(data) {
        $scope.orders = data.orders;
    });

});