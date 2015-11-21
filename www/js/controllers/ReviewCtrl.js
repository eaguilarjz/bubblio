angular.module('starter').controller('ReviewCtrl', function($scope, $stateParams, $ionicHistory, $filter, $state, Review, Rating, CurrentUser) {
    $scope.orderId = $stateParams.orderId; 
    $scope.userId = CurrentUser.getUserId();
    $scope.action = 'insert';
    $scope.review = {order_id: $stateParams.orderId, score: 0, anonymous_flag: 'N'};
    
    // Get the current review
    Review.get({order_id: $scope.orderId}, function(data) {
        if (typeof data.reviews[0] != 'undefined') {
            $scope.action = 'update';
            $scope.review = data.reviews[0];
        };
        $scope.review.stars = Rating.getImages($scope.review.score);
    });
    
    $scope.changeRating = function(idx) {
        $scope.review.score = (idx + 1);
        $scope.review.stars = Rating.getImages($scope.review.score);
    }
    
    $scope.saveReview = function() {
        if ($scope.action == 'insert') {
            Review.save({
                order_id: $scope.review.order_id,
                anonymous_flag: $scope.review.anonymous_flag,
                score: $scope.review.score,
                comments: $scope.review.comments,
                title: $scope.review.title
            }, function(data) {
                if (!data.Error) {
                    alert('Review saved!');
                    $ionicHistory.nextViewOptions({
                        disableBack: true
                    });
                    $state.go('app.order', {userId: $scope.userId, orderId: $scope.orderId});
                }
            });
        } else {
            Review.update({
                anonymous_flag: $scope.review.anonymous_flag,
                score: $scope.review.score,
                comments: $scope.review.comments,
                title: $scope.review.title,
                order_id: $scope.review.order_id
            }, function(data) {
                if (!data.Error) {
                    alert('Review updated!');
                    $ionicHistory.nextViewOptions({
                        disableBack: true
                    });
                    $state.go('app.order', {userId: $scope.userId, orderId: $scope.orderId});
                }
            });
        }
    }
});