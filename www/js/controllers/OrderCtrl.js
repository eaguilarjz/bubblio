angular.module('starter').controller('OrderCtrl', function($scope, $stateParams, $state, Orders, OrderDetails) {
    $scope.orderId = $stateParams.orderId;
    
    // Get order header
    Orders.get({user_id: $stateParams.userId, order_id: $scope.orderId}, function(data) {
        $scope.order = data.orders[0];
        
        // Get the order items
        OrderDetails.get({order_id: $scope.orderId}, function(data) {
            $scope.order.details = data.orders;
        })
    })
    
    $scope.viewHistory = function(ordId) {
        $state.go('app.history', {orderId: ordId});
    };
    
    $scope.review = function(ordId) {
        $state.go('app.review', {orderId: ordId});
    }
});