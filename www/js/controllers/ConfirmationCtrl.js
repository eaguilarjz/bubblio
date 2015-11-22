angular.module('starter').controller('ConfirmationCtrl', function($scope, $ionicHistory, $state) {
    $scope.createBubble = function() {
	    
        $ionicHistory.nextViewOptions({
            disableBack: true
        });
        $state.go('app.dashboard');
    }
});