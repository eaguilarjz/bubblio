angular.module('starter').controller('HistoryCtrl', function($scope, $stateParams, History) {
    $scope.orderId = $stateParams.orderId;
    
    // Get order history
    History.get({order_id: $scope.orderId}, function(data) {
        $scope.history = data.history;
    });
});